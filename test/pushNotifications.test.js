const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const webpush=require('web-push');
const express=require('express');
const {createDb}=require('../src/db');
const {createSharedRouter}=require('../src/sharedRoutes');

test('push sends generic localized notifications only to active other members and cleans expired devices independently',async t=>{
  const {createPushService}=require('../src/pushNotifications');
  const db=createDb(':memory:');t.after(()=>db.close());
  db.prepare('INSERT INTO shared_rooms VALUES (?,?,?,?,?,?,?)').run('room',1,'token','Русский','Английский','now','Meeting');
  const insertMember=db.prepare('INSERT INTO shared_members (id,room_id,user_key,role,name,last_seen,language,left_at) VALUES (?,?,?,?,?,?,?,?)');
  insertMember.run('sender','room','1','host','Alice','now','Русский',null);
  insertMember.run('active','room','2','guest','Bob','now','Английский',null);
  insertMember.run('left','room','3','guest','Left','now','Английский','now');
  db.prepare('INSERT INTO shared_messages (id,room_id,member_id,request_id,source_text,source_language,target_language,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(1,'room','sender','request-id','private secret text','Русский','Английский','failed','now');
  const keys=webpush.generateVAPIDKeys();
  const insert=db.prepare('INSERT INTO push_subscriptions (endpoint,user_key,p256dh,auth,locale,created_at) VALUES (?,?,?,?,?,?)');
  for(const [suffix,user,locale]of[['sender','1','ru'],['active','2','en'],['expired','2','zh'],['broken','2','ru'],['left','3','ru']])insert.run(`https://fcm.googleapis.com/${suffix}`,user,keys.publicKey,Buffer.alloc(16).toString('base64url'),locale,'now');
  const calls=[];const logs=[];
  const service=createPushService(db,{vapidKeys:keys,subject:'https://example.com',logger:()=>logs.push('error'),sendNotification:async(sub,payload,options)=>{
    calls.push({endpoint:sub.endpoint,payload:JSON.parse(payload),options});
    if(sub.endpoint.endsWith('expired'))throw{statusCode:410};
    if(sub.endpoint.endsWith('broken'))throw{statusCode:500,body:'private endpoint keys'};
  }});
  await service.publishNewMessage({roomId:'room',messageId:1,senderMemberId:'sender'});
  assert.equal(calls.length,3);assert.ok(calls.every(call=>!call.endpoint.endsWith('sender')&&!call.endpoint.endsWith('left')));
  assert.ok(calls.every(call=>!JSON.stringify(call.payload).includes('private secret text')));
  assert.match(calls.find(call=>call.endpoint.endsWith('active')).payload.body,/Alice.*Meeting/);
  assert.equal(calls[0].payload.data.url,'/#room=room');assert.equal(calls[0].payload.data.messageId,1);
  assert.ok(calls.every(call=>call.options.timeout===5000));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM push_subscriptions').get().count,4);assert.equal(logs.length,1);
});

test('VAPID keys are stable on disk, environment override is scoped, and public config never exposes private key',t=>{
  const {loadVapidKeys,createPushService}=require('../src/pushNotifications');
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'govori-push-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const keyFile=path.join(directory,'keys.json');
  const first=loadVapidKeys({keyFile,env:{}});const second=loadVapidKeys({keyFile,env:{}});assert.deepEqual(first,second);
  const alternate=webpush.generateVAPIDKeys();
  assert.deepEqual(loadVapidKeys({keyFile,env:{VAPID_PUBLIC_KEY:alternate.publicKey,VAPID_PRIVATE_KEY:alternate.privateKey}}),alternate);
  const db=createDb(':memory:');t.after(()=>db.close());
  assert.deepEqual(createPushService(db,{vapidKeys:first}).getConfig(),{enabled:true,publicKey:first.publicKey});
  assert.throws(()=>loadVapidKeys({keyFile,env:{VAPID_PUBLIC_KEY:'invalid'}}));
});

test('new shared messages publish once even when translation fails; retries and push errors cannot duplicate or break messages',async t=>{
  const db=createDb(':memory:');const sessions=new Map();const publications=[];let failTranslation=true;let failPush=false;
  const app=express();app.use(express.json());app.use((req,res,next)=>{const user=req.get('x-user');if(!sessions.has(user))sessions.set(user,{});req.session=sessions.get(user);req.user={id:user};req.access={authenticated:true};next();});
  app.use('/api/shared',createSharedRouter(db,{translateText:async(pair,text)=>failTranslation?{ok:false}:{ok:true,sourceLanguage:pair.source_language,targetLanguage:pair.target_language,translation:'Hello'}},{publishNewMessage:async message=>{publications.push(message);if(failPush)throw new Error('unavailable');}}));
  const server=await new Promise(resolve=>{const listener=app.listen(0,()=>resolve(listener));});t.after(()=>{server.closeAllConnections();server.close();db.close();});
  async function request(user,route,body){const response=await fetch(`http://127.0.0.1:${server.address().port}/api/shared${route}`,{method:'POST',headers:{'content-type':'application/json','x-user':user},body:JSON.stringify(body)});return{status:response.status,...await response.json()};}
  const {room}=await request('1','',{sourceLanguage:'Русский',targetLanguage:'Английский'});
  const failed=await request('1',`/${room.id}/messages`,{text:'Привет',requestId:'push-request'});assert.equal(failed.status,502);assert.equal(publications.length,1);
  failTranslation=false;assert.equal((await request('1',`/${room.id}/messages`,{text:'Привет',requestId:'push-request'})).status,200);assert.equal(publications.length,1);
  failPush=true;assert.equal((await request('1',`/${room.id}/messages`,{text:'Привет',requestId:'push-next'})).status,200);assert.equal(publications.length,2);
});

test('a slow push provider does not postpone translating or responding to a group message',async t=>{
  const db=createDb(':memory:'); let release; let started; let translated=false;
  const announced=new Promise(resolve=>{started=resolve;});
  const push=new Promise(resolve=>{release=resolve;});
  const app=express();app.use(express.json());app.use((req,res,next)=>{req.user={id:'1'};req.session={};req.access={authenticated:true};next();});
  app.use('/api/shared',createSharedRouter(db,{translateText:async pair=>{translated=true;return{ok:true,sourceLanguage:pair.source_language,targetLanguage:pair.target_language,translation:'Hello'};}},{publishNewMessage:()=>{started();return push;}}));
  const server=await new Promise(resolve=>{const listener=app.listen(0,()=>resolve(listener));});
  t.after(()=>{server.closeAllConnections();server.close();db.close();});
  const base=`http://127.0.0.1:${server.address().port}/api/shared`;
  const created=await fetch(base,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sourceLanguage:'Русский',targetLanguage:'Английский'})});
  const {room}=await created.json();
  const request=fetch(`${base}/${room.id}/messages`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({text:'Привет',requestId:'slow-notification'})});
  try{
    await announced; await new Promise(resolve=>setImmediate(resolve));
    assert.equal(translated,true,'translation starts without waiting for push delivery');
  }finally{release();await request;}
});

test('push validation accepts real browser providers and rejects malformed cryptographic keys, expiration and contact',()=>{
  const {isPushEndpoint,validateSubscription,isVapidSubject}=require('../src/pushNotifications');
  for(const endpoint of ['https://fcm.googleapis.com/device','https://updates.push.services.mozilla.com/device','https://web.push.apple.com/device','https://db5.notify.windows.com/device'])assert.equal(isPushEndpoint(endpoint),true);
  for(const endpoint of [null,'bad-url','https://fcm.googleapis.com/'+ 'a'.repeat(2048),'https://web.push.apple.com.evil.test/device','https://fcm.googleapis.com/device#fragment'])assert.equal(isPushEndpoint(endpoint),false);
  const subscription={endpoint:'https://fcm.googleapis.com/device',keys:{p256dh:webpush.generateVAPIDKeys().publicKey,auth:Buffer.alloc(16).toString('base64url')}};
  assert.ok(validateSubscription(subscription));
  for(const changed of [
    null,{...subscription,expirationTime:Date.now()-1},{...subscription,expirationTime:'tomorrow'},
    {...subscription,keys:{...subscription.keys,auth:Buffer.alloc(16).toString('base64url')+'='}},
    {...subscription,keys:{...subscription.keys,p256dh:Buffer.alloc(65).toString('base64url')}},
    {...subscription,keys:{...subscription.keys,p256dh:Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]).toString('base64url')}},
  ])assert.equal(validateSubscription(changed),null);
  assert.ok(validateSubscription({...subscription,expirationTime:Date.now()+100000}));
  for(const subject of ['https://example.com','mailto:admin@example.com'])assert.equal(isVapidSubject(subject),true);
  for(const subject of [null,'bad-url','http://example.com','https://localhost','https://127.0.0.1','https://user@example.com','https://example.com:8443'])assert.equal(isVapidSubject(subject),false);
});

test('disabled service, invalid keys and invalid persisted key files fail without exposing configuration',async t=>{
  const {createPushService,loadVapidKeys}=require('../src/pushNotifications');
  const db=createDb(':memory:');t.after(()=>db.close());
  const disabled=createPushService(db);assert.deepEqual(disabled.getConfig(),{enabled:false,publicKey:null});
  await disabled.publishNewMessage({roomId:'missing',messageId:1,senderMemberId:'missing'});
  const first=webpush.generateVAPIDKeys();const second=webpush.generateVAPIDKeys();
  assert.throws(()=>createPushService(db,{vapidKeys:{publicKey:first.publicKey,privateKey:second.privateKey}}));
  assert.throws(()=>createPushService(db,{vapidKeys:first,subject:'https://localhost'}));
  assert.throws(()=>createPushService(db,{vapidKeys:{publicKey:'bad',privateKey:'bad'}}));
  await createPushService(db,{vapidKeys:first,subject:'https://example.com'}).publishNewMessage({roomId:'missing',messageId:1,senderMemberId:'missing'});
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'govori-invalid-push-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const keyFile=path.join(directory,'keys.json');fs.writeFileSync(keyFile,'invalid-json');
  assert.throws(()=>loadVapidKeys({keyFile,env:{}}),/Unable to load Web Push keys/);
});

test('stalled provider delivery is bounded and does not reject the message publication',async t=>{
  const {createPushService}=require('../src/pushNotifications');
  const db=createDb(':memory:');t.after(()=>db.close());
  db.prepare('INSERT INTO shared_rooms VALUES (?,?,?,?,?,?,?)').run('room',1,'token','Русский','Английский','now','Meeting');
  const member=db.prepare('INSERT INTO shared_members (id,room_id,user_key,role,name,last_seen,language) VALUES (?,?,?,?,?,?,?)');
  member.run('sender','room','1','host','Alice','now','Русский');member.run('recipient','room','2','guest','Bob','now','Английский');
  db.prepare('INSERT INTO shared_messages (id,room_id,member_id,request_id,source_text,source_language,target_language,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(1,'room','sender','request-id','private','Русский','Английский','pending','now');
  const keys=webpush.generateVAPIDKeys();db.prepare('INSERT INTO push_subscriptions (endpoint,user_key,p256dh,auth,locale,created_at) VALUES (?,?,?,?,?,?)').run('https://fcm.googleapis.com/device','2',keys.publicKey,Buffer.alloc(16).toString('base64url'),'ru','now');
  const logs=[];const service=createPushService(db,{vapidKeys:keys,subject:'https://example.com',logger:message=>logs.push(message),sendNotification:()=>new Promise(()=>{})});
  t.mock.timers.enable({apis:['setTimeout']});
  const publication=service.publishNewMessage({roomId:'room',messageId:1,senderMemberId:'sender'});t.mock.timers.tick(5000);await publication;
  assert.deepEqual(logs,['Web Push delivery failed.']);assert.equal(db.prepare('SELECT COUNT(*) AS total FROM push_subscriptions').get().total,1);
});
