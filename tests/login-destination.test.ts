import assert from 'node:assert/strict';
import {test} from 'node:test';
import {loginDestination} from '../lib/login-destination';
test('login returns to the selected app page without external, auth, API, or role redirects',()=>{
  assert.equal(loginDestination('/apply?day=2026-11-01&area=%ED%99%8D%EB%8C%80%2F%ED%95%A9%EC%A0%95'),'/apply?day=2026-11-01&area=%ED%99%8D%EB%8C%80%2F%ED%95%A9%EC%A0%95');
  assert.equal(loginDestination('/applications?view=past'),'/applications?view=past');
  assert.equal(loginDestination('/admin/bookings?state=TO_BOOK',true),'/admin/bookings?state=TO_BOOK');
  for(const value of ['//evil.test','https://evil.test','/\\evil.test','/%2f%2fevil.test','/api/auth/login','/login','/signup','/admin','/guide/../../admin','/tables/%0aevil',null,{}])assert.equal(loginDestination(value),undefined,String(value));
  for(const value of ['/admin/login','/applications','/admin/../login','//evil.test'])assert.equal(loginDestination(value,true),undefined,value);
});
