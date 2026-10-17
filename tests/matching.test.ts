import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDeterministicGroups, isHardCompatible, preferredSize, type MatchCandidate } from '../lib/matching';

const candidate = (id: string, eventIds = ['e1']): MatchCandidate => ({
  applicationId: id, userId: id, birthYear: 1990, gender: Number(id.slice(-1)) % 2 ? 'MAN' : 'WOMAN', mbti: 'INTJ',
  interests: [], traits: [], desiredTraits: [], eventIds, paid: true, valid: true,
});

test('preferred table sizes maximize placements at every boundary', () => {
  assert.deepEqual([3,4,5,6,7,8,9,10,11,12].map(preferredSize), [0,4,5,6,6,4,5,6,6,6]);
  for (const [n, expected] of [[3,[]],[4,[4]],[5,[5]],[6,[6]],[7,[6]],[8,[4,4]],[9,[5,4]],[10,[6,4]],[11,[6,5]],[12,[6,6]] ] as Array<[number, number[]]>) {
    const result = buildDeterministicGroups(Array.from({ length: n }, (_, i) => candidate(String(i))));
    assert.deepEqual(result.groups.map((g) => g.members.length), expected);
    assert.equal(result.matchedCount, expected.reduce((a, b) => a + b, 0));
  }
});

test('common event is intersected across every group addition', () => {
  const result = buildDeterministicGroups([
    candidate('0', ['e1','e2']), candidate('1', ['e1']), candidate('2', ['e2']), candidate('3', ['e1','e2']),
  ]);
  assert.equal(result.groups.length, 0);
  assert.equal(result.unmatched.length, 4);
});

test('a user with overlapping event applications can occupy only one seat', () => {
  const window1={startsAt:'2030-01-01T18:00:00Z',endsAt:'2030-01-01T20:00:00Z'};
  const window2={startsAt:'2030-01-01T19:00:00Z',endsAt:'2030-01-01T21:00:00Z'};
  const first={...candidate('a0',['e1']),userId:'shared',eventTimes:{e1:window1}};
  const duplicate={...candidate('b0',['e2']),userId:'shared',eventTimes:{e2:window2}};
  const result = buildDeterministicGroups([first,candidate('a1',['e1']),candidate('a2',['e1']),candidate('a3',['e1']),duplicate,candidate('b1',['e2']),candidate('b2',['e2']),candidate('b3',['e2'])]);
  assert.equal(result.matchedCount, 4);
  assert.equal(new Set(result.groups.flatMap(g => g.members.map(m => m.userId))).size, 4);
});

test('a user may attend separate events when their times do not overlap', () => {
  const first = { ...candidate('a0', ['e1']), userId: 'shared', eventTimes: { e1: { startsAt: '2030-01-01T18:00:00Z', endsAt: '2030-01-01T20:00:00Z' } } };
  const second = { ...candidate('b0', ['e2']), userId: 'shared', eventTimes: { e2: { startsAt: '2030-01-02T18:00:00Z', endsAt: '2030-01-02T20:00:00Z' } } };
  const result = buildDeterministicGroups([first, candidate('a1',['e1']), candidate('a2',['e1']), candidate('a3',['e1']), second, candidate('b1',['e2']), candidate('b2',['e2']), candidate('b3',['e2'])]);
  assert.equal(result.matchedCount, 8);
  assert.equal(result.groups.length, 2);
});

test('active feedback exclusions prevent a later pair', () => {
  const a = candidate('a'); const b = { ...candidate('b'), blockedUserIds: ['a'] };
  assert.equal(isHardCompatible([a], b), false);
});
