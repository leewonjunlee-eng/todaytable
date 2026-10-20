import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NextRequest} from 'next/server';
import {proxy} from '../proxy';
import {sameOrigin} from '../lib/http';
import {POST as logout} from '../app/api/auth/logout/route';

test('separate public hosts route pages and keep mutations and logout on the correct origin',async()=>{
  const previous={app:process.env.APP_URL,admin:process.env.ADMIN_APP_URL};
  process.env.APP_URL='https://users.example';
  process.env.ADMIN_APP_URL='https://admin.example';
  try {
    const request=(host:string,path:string,origin?:string)=>new NextRequest(`http://internal:8080${path}`,{headers:{'x-forwarded-host':host,...(origin?{origin}:{})}});
    assert.equal(proxy(request('users.example','/admin/bookings?area=test')).headers.get('location'),'https://admin.example/admin/bookings?area=test');
    assert.equal(proxy(request('admin.example','/')).headers.get('location'),'https://admin.example/admin');
    assert.equal(proxy(request('admin.example','/login')).headers.get('location'),'https://admin.example/admin/login');
    assert.equal(proxy(request('admin.example','/admin/login')).headers.get('location'),null);
    assert.equal(proxy(request('admin.example','/applications?from=nav')).headers.get('location'),'https://users.example/applications?from=nav');
    assert.equal(proxy(request('attacker.example','/admin')).headers.get('location'),null);
    assert.equal(sameOrigin(request('admin.example','/api/admin/bookings','https://admin.example')),true);
    assert.equal(sameOrigin(request('admin.example','/api/admin/bookings','https://users.example')),false);
    assert.equal(sameOrigin(request('users.example','/api/profile','https://admin.example')),false);
    assert.equal(sameOrigin(request('admin.example','/api/admin/bookings','https://admin.example.attacker.test')),false);
    const response=await logout(request('admin.example','/api/auth/logout','https://admin.example'));
    assert.equal(response.headers.get('location'),'https://admin.example/admin/login');
    assert.match(response.headers.get('set-cookie')??'',/Max-Age=0/);
    assert.doesNotMatch(response.headers.get('set-cookie')??'',/Domain=/);
    delete process.env.ADMIN_APP_URL;
    assert.equal(proxy(request('users.example','/admin')).headers.get('location'),null);
  } finally {
    if(previous.app===undefined)delete process.env.APP_URL;else process.env.APP_URL=previous.app;
    if(previous.admin===undefined)delete process.env.ADMIN_APP_URL;else process.env.ADMIN_APP_URL=previous.admin;
  }
});
