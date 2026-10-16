import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isCanonicalUuid, validateApplicationSelection, retryDelayMs } from '../lib/domain';
import { hashPassword, newSessionToken, tokenHash, verifyPassword } from '../lib/security';

const eventA = '00000000-0000-4000-8000-000000000001';
const eventB = '00000000-0000-4000-8000-000000000002';

test('application selection validates distinct registered-shaped events and pass price', () => {
  assert.deepEqual(validateApplicationSelection([eventA, eventB], 'THREE_PASS'), {
    eventIds: [eventA, eventB], pass: 'THREE_PASS', uses: 3, amount: 15000,
  });
  assert.throws(() => validateApplicationSelection([], 'SINGLE'));
  assert.throws(() => validateApplicationSelection([eventA, eventA], 'SINGLE'));
  assert.throws(() => validateApplicationSelection(['------------------------------------'], 'SINGLE'));
  assert.throws(() => validateApplicationSelection([eventA], 'FREE'));
  assert.equal(isCanonicalUuid('00000000-0000-4000-8000-000000000001'), true);
  assert.equal(isCanonicalUuid('------------------------------------'), false);
});

test('retry backoff increases and caps at six hours', () => {
  assert.equal(retryDelayMs(1), 60_000);
  assert.equal(retryDelayMs(3), 240_000);
  assert.equal(retryDelayMs(99), 6 * 60 * 60 * 1000);
});

test('password hashes are salted and session tokens are stored as keyed digests', async () => {
  const first = await hashPassword('A long test passphrase');
  const second = await hashPassword('A long test passphrase');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('A long test passphrase', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(await verifyPassword('anything', 'plain-password'), false);

  process.env.SESSION_SECRET = 'test-secret-that-is-at-least-32-characters-long';
  const token = newSessionToken();
  assert.notEqual(tokenHash(token), token);
  assert.equal(tokenHash(token), tokenHash(token));
});
