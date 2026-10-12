const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { createApp } = require('../src/app');
const { createDb } = require('../src/db');

function subscription(endpoint='https://fcm.googleapis.com/fcm/send/device') {
  return { endpoint, keys: { p256dh: webpush.generateVAPIDKeys().publicKey, auth: Buffer.alloc(16, 7).toString('base64url') }, expirationTime: null };
}
async function setup(t, enabled=true) {
  const db=createDb(':memory:');
  const app=createApp({db,openaiClient:{},pushService:{getConfig:()=>({enabled,publicKey:enabled?'public-key':null}),publishNewMessage:async()=>{}}});
  const server=await new Promise(resolve=>{const listener=app.listen(0,()=>resolve(listener));});
  const base=`http://127.0.0.1:${server.address().port}`;
  t.after(()=>{server.closeAllConnections();server.close();db.close();});
  async function request(jar,route,body,method=body?'POST':'GET',origin=base){
    const response=await fetch(`${base}/api/push${route}`,{method,headers:{'content-type':'application/json',cookie:jar.cookie||'',Origin:origin},body:body?JSON.stringify(body):undefined});
    if(response.headers.get('set-cookie'))jar.cookie=response.headers.get('set-cookie').split(';')[0];
    const data=response.headers.get('content-type')?.includes('application/json')?await response.json():{};
    return {status:response.status,...data};
  }
  return {db,request};
}

test('push config exposes only public configuration and subscriptions persist with locale and own removal',async t=>{
  const {db,request}=await setup(t);const jar={};
  assert.deepEqual(await request(jar,'/config'),{status:200,ok:true,enabled:true,publicKey:'public-key'});
  const sub=subscription();
  assert.equal((await request(jar,'/subscriptions',{subscription:sub,locale:'zh'})).status,200);
  const saved=db.prepare('SELECT * FROM push_subscriptions').get();
  assert.equal(saved.endpoint,sub.endpoint);assert.equal(saved.locale,'zh');assert.match(saved.user_key,/^guest:/);
  assert.equal((await request({},'/subscriptions',{endpoint:sub.endpoint},'DELETE')).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get().count,1);
  assert.equal((await request(jar,'/subscriptions',{endpoint:sub.endpoint},'DELETE')).status,200);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get().count,0);
});

test('subscription registration rejects hostile endpoints, invalid keys, locales and cross-origin writes',async t=>{
  const {db,request}=await setup(t);const jar={};
  for(const endpoint of ['http://fcm.googleapis.com/device','https://localhost/device','https://127.0.0.1/device','https://fcm.googleapis.com.evil.test/device','https://fcm.googleapis.com:8443/device','https://user@fcm.googleapis.com/device','https://evil.test/device']){
    assert.equal((await request(jar,'/subscriptions',{subscription:subscription(endpoint),locale:'en'})).status,400);
  }
  const sub=subscription();
  assert.equal((await request(jar,'/subscriptions',{subscription:{...sub,keys:{...sub.keys,auth:'bad'}},locale:'en'})).status,400);
  assert.equal((await request(jar,'/subscriptions',{subscription:sub,locale:'de'})).status,400);
  assert.equal((await request(jar,'/subscriptions',{subscription:sub,locale:'ru'},'POST','https://evil.test')).status,403);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get().count,0);
});

test('endpoint cannot be stolen with different keys but device key proof permits account rebinding',async t=>{
  const {db,request}=await setup(t);const oldDevice={};const newAccount={};const sub=subscription();
  assert.equal((await request(oldDevice,'/subscriptions',{subscription:sub,locale:'ru'})).status,200);
  const oldOwner=db.prepare('SELECT user_key FROM push_subscriptions').get().user_key;
  assert.equal((await request(newAccount,'/subscriptions',{subscription:subscription(sub.endpoint),locale:'en'})).status,409);
  assert.equal(db.prepare('SELECT user_key FROM push_subscriptions').get().user_key,oldOwner);
  assert.equal((await request(newAccount,'/subscriptions',{subscription:sub,locale:'en'})).status,200);
  assert.notEqual(db.prepare('SELECT user_key FROM push_subscriptions').get().user_key,oldOwner);
  assert.equal(db.prepare('SELECT locale FROM push_subscriptions').get().locale,'en');
});

test('subscription count and mutation request rate are bounded',async t=>{
  const {db,request}=await setup(t);const jar={};
  for(let index=0;index<10;index++)assert.equal((await request(jar,'/subscriptions',{subscription:subscription(`https://fcm.googleapis.com/device-${index}`),locale:'ru'})).status,200);
  assert.equal((await request(jar,'/subscriptions',{subscription:subscription('https://fcm.googleapis.com/overflow'),locale:'ru'})).status,409);
  for(let index=0;index<9;index++)assert.equal((await request(jar,'/subscriptions',{endpoint:'https://fcm.googleapis.com/missing'},'DELETE')).status,200);
  assert.equal((await request(jar,'/subscriptions',{endpoint:'https://fcm.googleapis.com/missing'},'DELETE')).status,429);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get().count,10);
});

test('push disabled config remains readable and registration fails cleanly',async t=>{
  const {request}=await setup(t,false);const jar={};
  assert.equal((await request(jar,'/config')).enabled,false);
  assert.equal((await request(jar,'/subscriptions',{subscription:subscription(),locale:'ru'})).status,503);
});
