import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sameOrigin } from '../lib/http';

test('origin checks use the public app URL behind a reverse proxy', () => {
  const previous = process.env.APP_URL;
  try {
    process.env.APP_URL = 'https://todaytable-production.up.railway.app';
    const request = (origin?: string) => new Request('http://0.0.0.0:8080/api/auth/login', { headers: origin ? { origin } : {} });
    assert.equal(sameOrigin(request(process.env.APP_URL)), true);
    assert.equal(sameOrigin(request('https://attacker.example')), false);
    assert.equal(sameOrigin(request('http://todaytable-production.up.railway.app')), false);
    assert.equal(sameOrigin(request('https://todaytable-production.up.railway.app.attacker.example')), false);
    assert.equal(sameOrigin(request('invalid')), false);
    assert.equal(sameOrigin(request()), true);
    delete process.env.APP_URL;
    assert.equal(sameOrigin(new Request('http://localhost:3000/api/auth/login', { headers: { origin: 'http://localhost:3000' } })), true);
    assert.equal(sameOrigin(request('https://attacker.example')), false);
  } finally {
    if (previous === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = previous;
  }
});
