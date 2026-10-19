import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDeterministicGroups, isHardCompatible, preferredSize, groupScore, type MatchCandidate } from '../lib/matching';

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

test('personalization including atmosphere changes the full score by at most ten percent',()=>{
 const base=Array.from({length:6},(_,n)=>({...candidate(`cap-${n}`),interests:['여행'],traits:['경청'],desiredTraits:['경청']}));
 const learned=base.map(c=>({...c,atmosphere:'CALM',signalConfidence:1,preferredInterests:['여행'],learnedInterests:['여행']}));
 assert.ok(Math.abs(groupScore(learned)-groupScore(base))<=.1);
 const capacity=buildDeterministicGroups(Array.from({length:8},(_,n)=>candidate(`capacity-${n}`)),'capacity',0,undefined,6);
 assert.equal(capacity.matchedCount,6);
});

test('large cohorts compare bounded candidates reproducibly without losing eligible placements',t=>{
 const people=Array.from({length:24},(_,n)=>({...candidate(`large-${n}`),birthYear:1990+n%8,interests:['음악','여행']}));
 const start=performance.now(),first=buildDeterministicGroups(people,'large-cohort'),second=buildDeterministicGroups(people.slice().reverse(),'large-cohort');
 assert.equal(first.matchedCount,24);assert.deepEqual(first,second);for(const n of [19,25])assert.equal(buildDeterministicGroups(Array.from({length:n},(_,i)=>candidate(`boundary-${i}`)),'large-boundary').matchedCount,n);
 for(const group of first.groups){assert.ok(group.members.length>=4&&group.members.length<=6);assert.ok(Math.max(...group.members.map(m=>m.birthYear))-Math.min(...group.members.map(m=>m.birthYear))<=8);}
 t.diagnostic(`24 participants, two deterministic runs: ${Math.round(performance.now()-start)}ms`);
});

test('profile test trait labels satisfy the intended desired-person labels in real scoring',()=>{
 const weights={gender:0,mbti:0,interests:0,traits:1,novelty:0};
 const owner={...candidate('trait-owner'),traits:['깊은 대화를 좋아함'],desiredTraits:['깊은 대화가 되는 사람']};
 const deep={...candidate('trait-deep'),traits:['깊은 대화를 좋아함']};
 const light={...candidate('trait-light'),traits:['가볍고 유머 있는 대화를 좋아함']};
 assert.ok(groupScore([owner,deep],weights)>groupScore([owner,light],weights));
 assert.ok(groupScore([{...owner,desiredTraits:['나와 비슷한 사람']},deep],weights)>groupScore([{...owner,desiredTraits:['나와 비슷한 사람']},light],weights));
 assert.ok(groupScore([{...owner,desiredTraits:['나와 다른 자극을 주는 사람']},light],weights)>groupScore([{...owner,desiredTraits:['나와 다른 자극을 주는 사람']},deep],weights));
});
