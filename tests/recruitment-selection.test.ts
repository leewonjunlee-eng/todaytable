import assert from 'node:assert/strict';
import {test} from 'node:test';
import {hasRecruitmentSelection} from '../lib/recruitment-selection';

test('recruitment excludes unsupported dates and areas even when another combination is open',()=>{
 const events=[{day:'2026-11-01',area:'홍대/합정'},{day:'2026-11-02',area:'강남/역삼'}];
 assert.equal(hasRecruitmentSelection(events,['2026-11-01'],['강남/역삼']),false);
 assert.equal(hasRecruitmentSelection(events,['2026-11-01','2026-11-03'],['홍대/합정']),false);
 assert.equal(hasRecruitmentSelection(events,['2026-11-01'],['홍대/합정','강남/역삼']),false);
 assert.equal(hasRecruitmentSelection(events,['2026-11-01','2026-11-02'],['홍대/합정','강남/역삼']),true);
 assert.equal(hasRecruitmentSelection([],['2026-11-01'],['홍대/합정']),false);
});
