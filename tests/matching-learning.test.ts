import assert from 'node:assert/strict';
import {test} from 'node:test';
import {learnOutcomeWeights} from '../lib/matching-learning';

const base={gender:.4,mbti:.25,interests:.2,traits:.1,novelty:.05};
test('outcome learning needs enough completed tables and keeps adjustments bounded',()=>{
 const examples=Array.from({length:40},(_,i)=>({features:{gender:i%2,mbti:.5,interests:i%2,traits:.5,novelty:.5},outcome:i%2?.9:.2}));
 assert.deepEqual(learnOutcomeWeights(base,examples.slice(0,19)),base);
 const learned=learnOutcomeWeights(base,examples);
 assert.ok(learned.interests>base.interests);
 assert.ok(learned.gender>base.gender);
 assert.ok(Math.abs(Object.values(learned).reduce((n,v)=>n+v,0)-1)<.00001);
 assert.ok(Object.values(learned).every(value=>value>=.01));
 assert.deepEqual(learnOutcomeWeights(base,examples.map(x=>({...x,outcome:.5}))),base);
});
