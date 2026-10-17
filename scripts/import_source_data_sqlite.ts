import { readFile } from 'node:fs/promises';
import { db, databaseProvider } from '../lib/db';

type Payload = { sha256:string; filename:string; manifest:unknown; records:Array<{sheet_row:number;raw_values:string[];fields:Record<string,string>;issues:string[]}> };
async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('Usage: node --import tsx scripts/import_source_data_sqlite.ts <prepared-json>');
  if (databaseProvider !== 'sqlite') throw new Error('This staging importer is only for DATABASE_PROVIDER=sqlite.');
  const payload = JSON.parse(await readFile(filename,'utf8')) as Payload;
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO source_data_datasets(sha256,filename,manifest) VALUES($1,$2,$3) ON CONFLICT(sha256) DO NOTHING',[payload.sha256,payload.filename,payload.manifest]);
    for (const record of payload.records) await client.query(`INSERT INTO source_data_responses(dataset_sha256,sheet_name,sheet_row,raw_values,fields,issues)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(dataset_sha256,sheet_name,sheet_row) DO NOTHING`, [payload.sha256,(payload.manifest as any).sheet_name,record.sheet_row,record.raw_values,record.fields,record.issues]);
    await client.query('COMMIT');
    console.log(`Staged ${payload.records.length} provided source responses in SQLite (${payload.sha256}).`);
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); await db.end(); }
}

void main();
