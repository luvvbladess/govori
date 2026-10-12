const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createDb } = require('../src/db');
const { createApp } = require('../src/app');

async function fixture(run) {
  const db = createDb(':memory:'); const calls = []; const failed = new Set();
  const app = createApp({ db, openaiClient: {
    callOpenAI: async (target, text, options) => {
      calls.push({ target, text });
      if (failed.has(target)) return null;
      return { detected_lang: options.sourceLanguage, translation: target === 'Русский' ? 'Привет' : target === 'Испанский' ? 'Hola' : target === 'Французский' ? 'Bonjour' : 'Hello', new_target_lang: null };
    },
  } });
  const server = await new Promise(resolve => { const s = app.listen(0, () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const host = {};
  async function request(jar, route, body) {
    const res = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', cookie: jar.cookie || '' }, body: body ? JSON.stringify(body) : undefined });
    if (res.headers.get('set-cookie')) jar.cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, ...await res.json() };
  }
  try {
    await request(host, '/api/auth/register', { email:'groups@example.com', password:'password123', company:'Test' });
    await run({db, host, request, calls, failed});
  } finally { server.closeAllConnections(); server.close(); db.close(); }
}

test('named rooms isolate their histories and support several languages and late participants', () => fixture(async ({ host, request, calls }) => {
  const first = (await request(host, '/api/shared', { sourceLanguage:'Русский', targetLanguage:'Английский', name:'Host', title:'Trip' })).room;
  const second = (await request(host, '/api/shared', { sourceLanguage:'Русский', targetLanguage:'Английский', title:'Work' })).room;
  assert.notEqual(first.id, second.id); assert.notEqual(first.inviteToken, second.inviteToken);
  const english = {}, spanish = {}, alsoSpanish = {}, stranger = {};
  await request(english, '/api/shared/join', {token:first.inviteToken,language:'Английский',name:'Alex'});
  const joined = await request(spanish, '/api/shared/join', {token:first.inviteToken,language:'Испанский',name:'Maria'});
  await request(alsoSpanish, '/api/shared/join', {token:first.inviteToken,language:'Испанский',name:'Luis'});
  assert.equal(joined.room.sourceLanguage, 'Испанский');
  assert.equal((await request(spanish, '/api/shared/join', {token:first.inviteToken,language:'Английский'})).room.sourceLanguage, 'Испанский');
  assert.equal((await request(spanish, `/api/shared/${second.id}`)).status, 404);
  assert.equal((await request(stranger, `/api/shared/${first.id}`)).status, 404);
  const preview = await request(stranger, '/api/shared/invite/'+first.inviteToken);
  assert.equal(preview.title, 'Trip'); assert.equal(preview.participants, undefined);
  const sent = await request(host, `/api/shared/${first.id}/messages`, {text:'Привет',requestId:'group-message-one'});
  assert.equal(sent.message.translations['Английский'].text,'Hello');
  assert.equal(sent.message.translations['Испанский'].text,'Hola');
  assert.equal(calls.filter(c=>c.target==='Испанский').length,1);
  assert.equal((await request(host, `/api/shared/${first.id}`)).room.participants.length,4);
  assert.equal((await request(host, `/api/shared/${second.id}`)).messages.length,0);
  const rooms = (await request(host, '/api/shared')).rooms;
  assert.deepEqual(new Set(rooms.map(r=>r.title)),new Set(['Trip','Work']));
  assert.equal((await request(spanish, '/api/shared')).rooms.length,1);
  const french = {};
  await request(french, '/api/shared/join', {token:first.inviteToken,language:'Французский',name:'Camille'});
  const history = await request(french, `/api/shared/${first.id}`);
  assert.equal(history.messages[0].translations['Французский'].text,'Bonjour');
  const before = calls.length;
  await request(french, `/api/shared/${first.id}`);
  assert.equal(calls.length,before);
  const secondMessage = await request(spanish, `/api/shared/${first.id}/messages`, {text:'Hola',requestId:'group-message-two'});
  assert.equal(secondMessage.message.sourceLanguage,'Испанский');
  assert.equal(secondMessage.message.translations['Русский'].text,'Привет');
  assert.equal(secondMessage.message.translations['Французский'].text,'Bonjour');
  assert.equal((await request(spanish, `/api/shared/${first.id}?after=${sent.message.id}`)).messages.length,1);
}));

test('one failed language does not block other participants and can be retried privately', () => fixture(async ({host,request,failed}) => {
  const room = (await request(host,'/api/shared',{sourceLanguage:'Русский',targetLanguage:'Английский'})).room;
  const english={},spanish={},stranger={};
  await request(english,'/api/shared/join',{token:room.inviteToken,language:'Английский'});
  await request(spanish,'/api/shared/join',{token:room.inviteToken,language:'Испанский'});
  failed.add('Английский');
  const sent=await request(host,`/api/shared/${room.id}/messages`,{text:'Привет',requestId:'partial-failure'});
  assert.equal(sent.status,200); assert.equal(sent.message.status,'translated');
  assert.equal(sent.message.translations['Английский'].status,'failed');
  assert.equal(sent.message.translations['Испанский'].status,'translated');
  const route=`/api/shared/${room.id}/messages/${sent.message.id}/translation`;
  assert.equal((await request(stranger,route,{})).status,404);
  failed.clear();
  const retry=await request(english,route,{});
  assert.equal(retry.message.translations['Английский'].text,'Hello');
  assert.equal(retry.message.id,sent.message.id);
  assert.equal((await request(host,`/api/shared/${room.id}`)).messages.length,1);
}));

test('migration keeps old two-person rooms and messages and removes the one-guest constraint', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'translate-group-migration-')); const filename=path.join(dir,'app.db');
  let db=createDb(filename);
  try {
    db.exec(`DROP TABLE shared_members;
      CREATE TABLE shared_members(id TEXT PRIMARY KEY,room_id TEXT NOT NULL,user_key TEXT NOT NULL,role TEXT NOT NULL,name TEXT NOT NULL,last_seen TEXT NOT NULL,UNIQUE(room_id,role));
      INSERT INTO shared_rooms VALUES ('old',1,'old-token','Русский','Английский','date','Old conversation');
      INSERT INTO shared_members VALUES ('host','old','1','host','Host','date'),('guest','old','guest:old','guest','Guest','date');
      INSERT INTO shared_messages VALUES (1,'old','host','request-old','Привет','Русский','Hello','Английский','translated','date');`);
    db.close(); db=createDb(filename);
    assert.equal(db.prepare("SELECT language FROM shared_members WHERE id='host'").get().language,'Русский');
    assert.equal(db.prepare("SELECT language FROM shared_members WHERE id='guest'").get().language,'Английский');
    assert.equal(db.prepare("SELECT title FROM shared_rooms WHERE id='old'").get().title,'Old conversation');
    assert.equal(db.prepare('SELECT text FROM shared_translations WHERE message_id=1').get().text,'Hello');
    db.prepare('INSERT INTO shared_members (id,room_id,user_key,role,name,last_seen,language) VALUES (?,?,?,?,?,?,?)').run('third','old','guest:new','guest','Third','date','Испанский');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM shared_members').get().n,3);
    assert.throws(()=>db.prepare('INSERT INTO shared_members (id,room_id,user_key,role,name,last_seen,language) VALUES (?,?,?,?,?,?,?)').run('other-host','old','2','host','Other','date','Русский'));
  } finally { db.close(); fs.rmSync(dir,{recursive:true,force:true}); }
});
