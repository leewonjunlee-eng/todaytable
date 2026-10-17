// Import the prepared source into Railway production; preserve exact rows and workbook.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const project = 'ea8717f4-7740-44c1-a29f-f1107005a7e6';
const source = JSON.parse(readFileSync('.data/provided-data-import.json', 'utf8'));
assert.equal(source.records.length, source.manifest.record_count);
assert.equal(source.records.length, 294);
const sql = readFileSync('db/imports/provided_data.sql', 'utf8');
if (!process.argv.includes('--apply')) {
  console.log(JSON.stringify({ mode: 'preview', project, environment: 'production', filename: source.filename, sha256: source.sha256, count: source.records.length }));
  process.exit(0);
}

const packed = gzipSync(Buffer.from(JSON.stringify({ source, sql }))).toString('base64');
const code = `
const assert=require('node:assert/strict');const {Client}=require('pg');const {createHash}=require('node:crypto');
const {source,sql}=JSON.parse(require('node:zlib').gunzipSync(Buffer.from('${packed}','base64')));
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:15000});
try{assert.equal(process.env.DATABASE_PROVIDER,'postgres');await c.connect();await c.query('BEGIN');await c.query(sql);
await c.query("SELECT pg_advisory_xact_lock(hashtextextended('todaytable:provided-data-import',0))");
const inserted=await c.query('INSERT INTO provided_data.datasets(sha256,filename,original_file,manifest) VALUES($1,$2,$3,$4) ON CONFLICT(sha256) DO NOTHING RETURNING sha256',[source.sha256,source.filename,Buffer.from(source.original_base64,'base64'),JSON.stringify(source.manifest)]);
let added=0;
for(const r of source.records){const result=await c.query('INSERT INTO provided_data.survey_responses(dataset_sha256,sheet_name,sheet_row,raw_values,fields,issues) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING sheet_row',[source.sha256,source.manifest.sheet_name,r.sheet_row,JSON.stringify(r.raw_values),JSON.stringify(r.fields),JSON.stringify(r.issues)]);added+=result.rowCount;}
const dataset=(await c.query('SELECT filename,original_file,manifest FROM provided_data.datasets WHERE sha256=$1',[source.sha256])).rows[0];
assert.equal(dataset.filename,source.filename);assert.deepEqual(dataset.manifest,source.manifest);
assert.equal(createHash('sha256').update(dataset.original_file).digest('hex'),source.sha256);
const rows=(await c.query('SELECT sheet_row,raw_values,fields,issues FROM provided_data.survey_responses WHERE dataset_sha256=$1 AND sheet_name=$2 ORDER BY sheet_row',[source.sha256,source.manifest.sheet_name])).rows;
assert.deepEqual(rows,source.records);
if(inserted.rowCount)await c.query("INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,after_data) VALUES((SELECT id FROM users WHERE email='operator@todaytable.local'),'SOURCE_DATA_IMPORTED','provided_dataset',$1,$2)",[source.sha256,JSON.stringify({filename:source.filename,recordCount:rows.length,originalFileVerified:true})]);
await c.query('COMMIT');
console.log(JSON.stringify({committed:true,sha256:source.sha256,filename:source.filename,insertedRows:added,storedRows:rows.length,firstSourceRow:rows[0].sheet_row,lastSourceRow:rows.at(-1).sheet_row,workbookHashVerified:true,allFieldsRoundtripVerified:true}));
}catch(e){await c.query('ROLLBACK').catch(()=>{});console.error(e.message);process.exitCode=1;}finally{await c.end();}})();`;
assert.ok(Buffer.byteLength(code) < 120000, 'Remote payload exceeds safe argument size');
const temp = mkdtempSync(path.join(tmpdir(), 'todaytable-source-import-'));
let keyId;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 55000, maxBuffer: 3_000_000, ...options });
  if (result.error || result.status !== 0) throw new Error(result.error?.message ?? `${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
try {
  const key = path.join(temp, 'id_ed25519');
  run('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'todaytable-source-data-import', '-f', key]);
  const query = path.join(temp, 'register.graphql');
  const variables = path.join(temp, 'register.json');
  writeFileSync(query, 'mutation($input:SshPublicKeyCreateInput!){sshPublicKeyCreate(input:$input){id}}');
  writeFileSync(variables, JSON.stringify({ input: { name: 'todaytable-source-import-temporary', publicKey: readFileSync(key + '.pub', 'utf8').trim() } }));
  const registered = JSON.parse(run('railway', ['api', '--file', query, '--variables', '@' + variables, '--compact']));
  keyId = registered.data?.sshPublicKeyCreate?.id;
  assert.ok(keyId, 'Temporary key registration failed');
  const bin = path.join(temp, 'bin'); mkdirSync(bin);
  writeFileSync(path.join(bin, 'ssh'), `#!/bin/sh\nexec /usr/bin/ssh -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=${path.join(temp, 'known_hosts')} "$@"\n`, { mode: 0o700 });
  const result = run('railway', ['ssh', '--project', project, '--service', 'todaytable', '--environment', 'production', '--identity-file', key, 'node', '-e', code], { env: { ...process.env, PATH: bin + ':' + process.env.PATH } });
  process.stdout.write(result);
} finally {
  if (keyId) {
    run('railway', ['ssh', 'keys', 'remove', keyId]);
    console.log('Temporary Railway SSH key removed.');
  }
  rmSync(temp, { recursive: true, force: true });
}
