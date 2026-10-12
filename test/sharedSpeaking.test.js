const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createDb } = require('../src/db');
const { createSharedRouter } = require('../src/sharedRoutes');

async function setup(t) {
  const db = createDb(':memory:');
  const sessions = new Map();
  let time = 100000;
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    const user = req.get('x-user');
    if (!sessions.has(user)) sessions.set(user, {});
    req.session = sessions.get(user);
    req.user = { id: user };
    req.access = { authenticated: !user.startsWith('guest:') };
    next();
  });
  app.use('/api/shared', createSharedRouter(db, {
    translateText: async (pair, text) => ({ ok: true,
      sourceLanguage: pair.source_language, targetLanguage: pair.target_language,
      translation: `${pair.target_language}: ${text}` }),
  }, { now: () => time }));
  const server = await new Promise(resolve => {
    const listener = app.listen(0, () => resolve(listener));
  });
  t.after(() => { server.closeAllConnections(); server.close(); db.close(); });
  async function request(user, route, body) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/shared${route}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-user': user },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (response.headers.get('content-type') || '').includes('application/json')
      ? await response.json() : {};
    return { status: response.status, ...data };
  }
  const { room } = await request('host', '', { sourceLanguage: 'Русский', targetLanguage: 'Английский', name: 'Host' });
  const joined = await request('guest:alice', '/join', { token: room.inviteToken, name: 'Alice' });
  await request('guest:bob', '/join', { token: room.inviteToken, name: 'Bob', language: 'Испанский' });
  return { request, room, aliceId: joined.room.memberId, advance: milliseconds => { time += milliseconds; } };
}

test('speaking is visible to group participants and updates only the caller', async t => {
  const { request, room, aliceId } = await setup(t);
  const initial = await request('host', `/${room.id}`);
  assert.ok(initial.room.participants.every(member => member.speaking === false));
  assert.equal((await request('guest:alice', `/${room.id}/speaking`, { speaking: true })).status, 200);
  const observed = await request('guest:bob', `/${room.id}`);
  assert.deepEqual(observed.room.participants.filter(member => member.speaking).map(member => member.id), [aliceId]);
  const list = await request('host', '');
  assert.equal(list.rooms[0].participants.find(member => member.id === aliceId).speaking, true);
  assert.equal((await request('guest:alice', `/${room.id}/speaking`, { speaking: false })).status, 200);
  assert.ok((await request('host', `/${room.id}`)).room.participants.every(member => member.speaking === false));
});

test('speaking status expires unless heartbeats renew it', async t => {
  const { request, room, aliceId, advance } = await setup(t);
  const aliceSpeaking = async () => (await request('host', `/${room.id}`)).room.participants.find(member => member.id === aliceId).speaking;
  await request('guest:alice', `/${room.id}/speaking`, { speaking: true });
  advance(5999);
  assert.equal(await aliceSpeaking(), true);
  await request('guest:alice', `/${room.id}/speaking`, { speaking: true });
  advance(5999);
  assert.equal(await aliceSpeaking(), true);
  advance(1);
  assert.equal(await aliceSpeaking(), false);
});

test('speaking endpoint validates booleans, rejects spoofing and enforces room membership', async t => {
  const { request, room, aliceId } = await setup(t);
  for (const body of [{}, { speaking: 'true' }, { speaking: 1 }, { speaking: null }, { speaking: true, memberId: aliceId }, []]) {
    assert.equal((await request('host', `/${room.id}/speaking`, body)).status, 400);
  }
  assert.equal((await request('stranger', `/${room.id}/speaking`, { speaking: true })).status, 404);
  const second = await request('host2', '', { sourceLanguage: 'Русский', targetLanguage: 'Английский' });
  assert.equal((await request('guest:alice', `/${second.room.id}/speaking`, { speaking: true })).status, 404);
  await request('guest:alice', `/${room.id}/speaking`, { speaking: true });
  assert.ok((await request('host2', `/${second.room.id}`)).room.participants.every(member => member.speaking === false));
});

test('leaving clears speaking and denies further updates until explicit rejoin', async t => {
  const { request, room, aliceId } = await setup(t);
  await request('guest:alice', `/${room.id}/speaking`, { speaking: true });
  assert.equal((await request('guest:alice', `/${room.id}/leave`, {})).status, 200);
  assert.equal((await request('guest:alice', `/${room.id}/speaking`, { speaking: true })).status, 404);
  assert.equal((await request('host', `/${room.id}`)).room.participants.some(member => member.id === aliceId), false);
  const rejoined = await request('guest:alice', '/join', { token: room.inviteToken });
  assert.equal(rejoined.room.participants.find(member => member.id === aliceId).speaking, false);
});

test('speaking heartbeats have a separate rate limit and do not exhaust translation quota', async t => {
  const { request, room } = await setup(t);
  for (let i = 0; i < 35; i++) {
    assert.equal((await request('guest:alice', `/${room.id}/speaking`, { speaking: true })).status, 200);
  }
  assert.equal((await request('guest:alice', `/${room.id}/messages`, { text: 'Hello', requestId: 'after-heartbeats' })).status, 200);
});
