import assert from 'node:assert/strict';
import {test} from 'node:test';
import {isAllowedGenderComposition,buildDeterministicGroups,type MatchCandidate} from '../lib/matching';
const people=(men:number,women:number,unknown=0):MatchCandidate[]=>[...Array(men).fill('MAN'),...Array(women).fill('WOMAN'),...Array(unknown).fill('PREFER_NOT_TO_SAY')].map((gender,i)=>({applicationId:String(i),userId:String(i),birthYear:1995,gender,mbti:'ENFP',interests:['음악'],traits:[],desiredTraits:[],eventIds:['round'],paid:true,valid:true}));
test('exactly the six requested gender compositions are permitted',()=>{
 for(let n=0;n<=8;n++)for(let men=0;men<=n;men++)assert.equal(isAllowedGenderComposition(people(men,n-men)),n>=4&&n<=6&&men>=2&&n-men>=2,`${men}/${n-men}`);
 for(let n=4;n<=6;n++)assert.equal(isAllowedGenderComposition(people(2,n-3,1)),false);
});
test('high compatibility scores never bypass the gender hard rule',()=>{
 for(const [m,w] of [[4,0],[3,1],[1,3],[0,4],[1,4],[4,1],[1,5],[5,1]]){const r=buildDeterministicGroups(people(m,w),'strict',0,{gender:0,mbti:1,interests:0,traits:0,novelty:0});assert.equal(r.matchedCount,0,`${m}/${w}`);}
 for(const [m,w] of [[2,2],[2,3],[3,2],[2,4],[3,3],[4,2]]){const r=buildDeterministicGroups(people(m,w));assert.equal(r.matchedCount,m+w);assert.ok(r.groups.every(g=>isAllowedGenderComposition(g.members)));}
});
test('source imbalance stays unmatched without inventing genders',()=>{const r=buildDeterministicGroups(people(2,10));assert.ok(r.matchedCount<=6);assert.ok(r.groups.every(g=>isAllowedGenderComposition(g.members)));assert.equal(r.matchedCount+r.unmatched.length,12);assert.equal(buildDeterministicGroups(people(2,1,1)).matchedCount,0);});
