"""Disposable production QA, using generated audio rather than a user's microphone."""
import asyncio, io, json, os, sys, time, uuid, urllib.request, http.cookiejar
from pathlib import Path
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
sys.path.insert(0, str(Path(os.environ['TEMP']) / 'lexiqs-webrtc-qa'))
import av, numpy as np, paramiko
from aiortc import RTCPeerConnection, RTCSessionDescription, AudioStreamTrack
from fractions import Fraction

root = Path(__file__).resolve().parent.parent
email = 'voice-qa-' + uuid.uuid4().hex + '@example.com'
base = 'https://lexiqs.space'
def session():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
host, guest = session(), session()
def request(client, path, payload=None, raw=None, mime=None):
    body = raw if raw is not None else (json.dumps(payload).encode() if payload is not None else None)
    req = urllib.request.Request(base + path, data=body, headers={'Content-Type': mime or 'application/json'})
    with client.open(req, timeout=70) as response:
        data = response.read()
        return json.loads(data) if 'json' in response.headers.get('Content-Type', '') else data

class TestAudio(AudioStreamTrack):
    def __init__(self, samples):
        super().__init__(); self.samples = samples; self.offset = 0; self.begin = None
    async def recv(self):
        if self.begin is None: self.begin = time.monotonic()
        await asyncio.sleep(max(0, self.begin + self.offset / 48000 - time.monotonic()))
        chunk = self.samples[self.offset:self.offset+960]
        chunk = np.pad(chunk, (0, 960-len(chunk))).astype(np.int16)
        frame = av.AudioFrame.from_ndarray(chunk.reshape(1, -1), format='s16', layout='mono')
        frame.sample_rate = 48000; frame.pts = self.offset; frame.time_base = Fraction(1, 48000)
        self.offset += 960
        return frame

async def verify():
    request(host, '/api/auth/register', {'email': email, 'password': uuid.uuid4().hex, 'company': 'Disposable QA'})
    room = request(host, '/api/shared', {'sourceLanguage':'Русский','targetLanguage':'Английский','name':'QA host'})['room']
    request(guest, '/api/shared/join', {'token':room['inviteToken'],'name':'QA guest'})
    audio = request(guest, '/api/translator/speech', {'text':'Hello, I am testing this translator. How are you today?', 'language':'Английский'})
    result = request(guest, '/api/shared/'+room['id']+'/transcribe', raw=audio, mime='audio/mpeg')
    print('Recorded transcription:', result.get('text'), flush=True)
    resampler = av.AudioResampler(format='s16', layout='mono', rate=48000)
    chunks = []
    for frame in av.open(io.BytesIO(audio)).decode(audio=0):
        chunks.extend(f.to_ndarray().flatten() for f in resampler.resample(frame))
    chunks.extend(f.to_ndarray().flatten() for f in resampler.resample(None))
    samples = np.concatenate([np.zeros(48000,dtype=np.int16), *chunks, np.zeros(48000*50,dtype=np.int16)])
    pc = RTCPeerConnection(); completed = asyncio.get_running_loop().create_future()
    pc.addTrack(TestAudio(samples)); channel = pc.createDataChannel('oai-events')
    @channel.on('message')
    def receive(data):
        event = json.loads(data)
        if event.get('type') == 'conversation.item.input_audio_transcription.completed' and not completed.done():
            completed.set_result(event.get('transcript'))
        if event.get('type') == 'error' and not completed.done():
            completed.set_exception(RuntimeError(event.get('error',{}).get('code','Realtime error')))
    try:
        await pc.setLocalDescription(await pc.createOffer())
        answer = await asyncio.to_thread(request, guest, '/api/shared/'+room['id']+'/live/session', {'sdp':pc.localDescription.sdp})
        await pc.setRemoteDescription(RTCSessionDescription(answer['sdp'],'answer'))
        transcript = await asyncio.wait_for(completed, 45)
        print('Live WebRTC transcription:', transcript, flush=True)
        assert transcript and 'hello' in transcript.lower()
        request(guest, '/api/shared/'+room['id']+'/messages', {'text':transcript,'requestId':uuid.uuid4().hex})
        a = request(host, '/api/shared/'+room['id'])['messages']
        b = request(guest, '/api/shared/'+room['id'])['messages']
        assert a == b and a[-1]['status'] == 'translated'
        print('Shared live transcript and translation: PASS', flush=True)
    finally: await pc.close()

try: asyncio.run(verify())
finally:
    credentials = (root/'serv.txt').read_text().splitlines()
    ssh = paramiko.SSHClient(); ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    ssh.connect(credentials[0].strip(), username=credentials[1].strip(), password=credentials[2].strip(), timeout=20)
    script = "import sqlite3\nc=sqlite3.connect('/opt/lexiqs/app/data/app.db')\nu=c.execute('SELECT id FROM users WHERE email=?',("+repr(email)+",)).fetchone()\nif u:\n c.execute('DELETE FROM shared_translations WHERE message_id IN (SELECT id FROM shared_messages WHERE room_id IN (SELECT id FROM shared_rooms WHERE owner_id=?))',u)\n c.execute('DELETE FROM shared_messages WHERE room_id IN (SELECT id FROM shared_rooms WHERE owner_id=?)',u)\n c.execute('DELETE FROM shared_members WHERE room_id IN (SELECT id FROM shared_rooms WHERE owner_id=?)',u)\n c.execute('DELETE FROM shared_rooms WHERE owner_id=?',u)\n c.execute('DELETE FROM users WHERE id=?',u)\n c.commit()\nc.close()\n"
    _, out, err = ssh.exec_command("python3 - <<'PY'\n"+script+'PY')
    assert out.channel.recv_exit_status() == 0, err.read().decode()
    ssh.close(); print('Disposable QA database rows removed.', flush=True)
