const express = require('express');
const rateLimit = require('express-rate-limit');
const { randomUUID, randomBytes } = require('node:crypto');
const { isKnownLanguage, codeForLanguage } = require('./languages');
function createSharedRouter(db, translator) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 60000, max: 30, keyGenerator: (req) => String(req.user.id), standardHeaders: true, legacyHeaders: false });
  const now = () => new Date().toISOString();
  const translating = new Map();
  function memberFor(req, roomId) {
    const account = db.prepare('SELECT * FROM shared_members WHERE room_id=? AND user_key=?').get(roomId, String(req.user.id));
    return account || db.prepare('SELECT * FROM shared_members WHERE room_id=? AND id=?').get(roomId, req.session.sharedRooms?.[roomId] || '');
  }
  function remember(req, member) { req.session.sharedRooms ||= {}; req.session.sharedRooms[member.room_id] = member.id; }
  function roomView(room, member) {
    const participants = db.prepare('SELECT id,role,name,language,last_seen AS lastSeen FROM shared_members WHERE room_id=? ORDER BY rowid').all(room.id);
    return { id:room.id, title:room.title, sourceLanguage:member.language,
      targetLanguage:member.language === room.source_language ? room.target_language : room.source_language,
      memberId:member.id, role:member.role, inviteToken:member.role === 'host' ? room.invite_token : undefined, participants };
  }
  function access(req, res, next) {
    const room = db.prepare('SELECT * FROM shared_rooms WHERE id=?').get(req.params.id);
    const member = room && memberFor(req, room.id);
    if (!member) return res.status(404).json({ok:false,code:'ROOM_NOT_FOUND'});
    req.room=room; req.member=member;
    if (req.access.authenticated && member.user_key.startsWith('guest:')) db.prepare('UPDATE shared_members SET user_key=? WHERE id=?').run(String(req.user.id),member.id);
    db.prepare('UPDATE shared_members SET last_seen=? WHERE id=?').run(now(),member.id); next();
  }
  const messageSelect = `SELECT m.id,m.request_id AS requestId,m.member_id AS memberId,p.name AS senderName,
    m.source_text AS sourceText,m.source_language AS sourceLanguage,m.translation_text AS translationText,
    m.target_language AS targetLanguage,m.status,m.created_at AS createdAt FROM shared_messages m JOIN shared_members p ON p.id=m.member_id`;
  function messageView(id) {
    const message = db.prepare(`${messageSelect} WHERE m.id=?`).get(id);
    if (!message) return null;
    message.translations = Object.fromEntries(db.prepare('SELECT language,text,status FROM shared_translations WHERE message_id=?').all(id).map(t=>[t.language,{text:t.text,status:t.status}]));
    return message;
  }
  async function translateFor(message, language, retry=false) {
    if (language === message.sourceLanguage) return {text:message.sourceText,status:'translated'};
    const key = `${message.id}:${language}`;
    if (translating.has(key)) return translating.get(key);
    const saved = db.prepare('SELECT text,status FROM shared_translations WHERE message_id=? AND language=?').get(message.id,language);
    if (saved && (saved.status === 'translated' || !retry)) return saved;
    db.prepare("INSERT INTO shared_translations VALUES (?,?,NULL,'pending') ON CONFLICT(message_id,language) DO UPDATE SET status='pending'").run(message.id,language);
    const work = (async()=>{
      let text=null; let status='failed';
      try {
        const result=await translator.translateText({source_language:message.sourceLanguage,target_language:language},message.sourceText);
        if (result.ok && result.sourceLanguage===message.sourceLanguage && result.targetLanguage===language) {text=result.translation;status='translated';}
      } catch { /* Keep the original when one language is unavailable. */ }
      db.prepare('UPDATE shared_translations SET text=?,status=? WHERE message_id=? AND language=?').run(text,status,message.id,language);
      return {text,status};
    })();
    translating.set(key,work);
    try {return await work;} finally {translating.delete(key);}
  }
  router.post('/',limiter,(req,res)=>{
    if (!req.access.authenticated) return res.status(403).json({ok:false,code:'REGISTRATION_REQUIRED'});
    const {sourceLanguage,targetLanguage,name,title}=req.body||{};
    if (!isKnownLanguage(sourceLanguage)||!isKnownLanguage(targetLanguage)||sourceLanguage===targetLanguage) return res.status(400).json({ok:false,code:'INVALID_LANGUAGE_PAIR'});
    if (title!==undefined&&(typeof title!=='string'||title.length>100)) return res.status(400).json({ok:false,code:'INVALID_INPUT'});
    const id=randomUUID(),token=randomBytes(32).toString('hex'),memberId=randomUUID();
    db.transaction(()=>{
      db.prepare('INSERT INTO shared_rooms (id,owner_id,invite_token,source_language,target_language,created_at,title) VALUES (?,?,?,?,?,?,?)').run(id,req.user.id,token,sourceLanguage,targetLanguage,now(),title?.trim()||'');
      db.prepare('INSERT INTO shared_members VALUES (?,?,?,?,?,?,?)').run(memberId,id,String(req.user.id),'host',typeof name==='string'&&name.trim()?name.trim().slice(0,60):'1',now(),sourceLanguage);
    })();
    const member=memberFor(req,id);remember(req,member);res.json({ok:true,room:roomView(db.prepare('SELECT * FROM shared_rooms WHERE id=?').get(id),member)});
  });
  router.get('/',(req,res)=>{
    res.set('Cache-Control','no-store');
    const remembered=Object.values(req.session.sharedRooms||{}).slice(-100);
    const rooms=db.prepare(`SELECT DISTINCT r.* FROM shared_rooms r JOIN shared_members p ON p.room_id=r.id WHERE p.user_key=? ${remembered.length?`OR p.id IN (${remembered.map(()=>'?').join(',')})`:''} ORDER BY r.created_at DESC`).all(String(req.user.id),...remembered);
    res.json({ok:true,rooms:rooms.map(room=>roomView(room,memberFor(req,room.id)))});
  });
  router.get('/invite/:token',(req,res)=>{
    const room=/^[a-f0-9]{64}$/.test(req.params.token)&&db.prepare('SELECT title,target_language FROM shared_rooms WHERE invite_token=?').get(req.params.token);
    if (!room) return res.status(404).json({ok:false,code:'ROOM_NOT_FOUND'});
    res.set('Cache-Control','no-store').json({ok:true,title:room.title,language:room.target_language});
  });
  router.post('/join',limiter,(req,res)=>{
    const {token,name,language}=req.body||{};
    if (typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)) return res.status(404).json({ok:false,code:'ROOM_NOT_FOUND'});
    const room=db.prepare('SELECT * FROM shared_rooms WHERE invite_token=?').get(token);
    if (!room) return res.status(404).json({ok:false,code:'ROOM_NOT_FOUND'});
    if (language!==undefined&&!isKnownLanguage(language)) return res.status(400).json({ok:false,code:'INVALID_LANGUAGE_PAIR'});
    let member=memberFor(req,room.id);
    if (!member) {
      const id=randomUUID();db.prepare('INSERT INTO shared_members VALUES (?,?,?,?,?,?,?)').run(id,room.id,String(req.user.id),'guest',typeof name==='string'&&name.trim()?name.trim().slice(0,60):'2',now(),language||room.target_language);
      member=db.prepare('SELECT * FROM shared_members WHERE id=?').get(id);
    }
    remember(req,member);res.json({ok:true,room:roomView(room,member)});
  });
  router.get('/:id',access,async(req,res,next)=>{
    try {
      res.set('Cache-Control','no-store');const after=Number(req.query.after||0);
      const pending=typeof req.query.pending==='string'&&req.query.pending?req.query.pending.split(',').map(Number):[];
      if (!Number.isSafeInteger(after)||after<0||pending.length>100||pending.some(id=>!Number.isSafeInteger(id)||id<1)) return res.status(400).json({ok:false,code:'INVALID_INPUT'});
      const messages=db.prepare(`${messageSelect} WHERE m.room_id=? AND (m.id>? ${pending.length?`OR m.id IN (${pending.map(()=>'?').join(',')})`:''}) ORDER BY m.id`).all(req.room.id,after,...pending);
      // Translate old history on demand for a new participant's language.
      for (const message of messages) if (message.status==='translated'&&message.memberId!==req.member.id) await translateFor(message,req.member.language);
      res.json({ok:true,room:roomView(req.room,req.member),messages:messages.map(m=>messageView(m.id))});
    } catch(error){next(error);}
  });
  router.post('/:id/messages',access,limiter,async(req,res,next)=>{
    try {
      const {text,requestId}=req.body||{};
      if (typeof text!=='string'||!text.trim()||text.length>12000||typeof requestId!=='string'||!/^[\w-]{8,80}$/.test(requestId)) return res.status(400).json({ok:false,code:'INVALID_INPUT'});
      let message=db.prepare('SELECT * FROM shared_messages WHERE room_id=? AND member_id=? AND request_id=?').get(req.room.id,req.member.id,requestId);
      if(message&&message.source_text!==text.trim()) return res.status(400).json({ok:false,code:'INVALID_INPUT'});
      if(message&&message.status!=='failed') return res.json({ok:true,message:messageView(message.id)});
      const sourceLanguage=req.member.language,targetLanguage=sourceLanguage===req.room.source_language?req.room.target_language:req.room.source_language;
      if(message) db.prepare("UPDATE shared_messages SET status='pending' WHERE id=?").run(message.id);
      else {
        const info=db.prepare(`INSERT INTO shared_messages (room_id,member_id,request_id,source_text,source_language,target_language,status,created_at) VALUES (?,?,?,?,?,?,'pending',?)`).run(req.room.id,req.member.id,requestId,text.trim(),sourceLanguage,targetLanguage,now());message={id:Number(info.lastInsertRowid)};
      }
      const view=messageView(message.id);
      const languages=[...new Set([targetLanguage,...db.prepare('SELECT DISTINCT language FROM shared_members WHERE room_id=?').all(req.room.id).map(p=>p.language)])].filter(language=>language!==sourceLanguage);
      const outcomes=await Promise.all(languages.map(async language=>({language,...await translateFor(view,language,true)})));
      const primary=outcomes.find(t=>t.language===targetLanguage&&t.status==='translated')||outcomes.find(t=>t.status==='translated');
      if(!primary) {db.prepare("UPDATE shared_messages SET status='failed' WHERE id=?").run(message.id);return res.status(502).json({ok:false,code:'TRANSLATION_FAILED',message:messageView(message.id)});}
      db.prepare("UPDATE shared_messages SET translation_text=?,target_language=?,status='translated' WHERE id=?").run(primary.text,primary.language,message.id);
      res.json({ok:true,message:messageView(message.id)});
    }catch(error){next(error);}
  });
  router.post('/:id/messages/:messageId/translation',access,limiter,async(req,res,next)=>{
    try{
      const message=db.prepare(`${messageSelect} WHERE m.room_id=? AND m.id=?`).get(req.room.id,req.params.messageId);
      if(!message||message.status!=='translated') return res.status(404).json({ok:false,code:'ROOM_NOT_FOUND'});
      await translateFor(message,req.member.language,true);res.json({ok:true,message:messageView(message.id)});
    }catch(error){next(error);}
  });
  router.post('/:id/transcribe',access,limiter,express.raw({type:'audio/*',limit:'24mb'}),async(req,res,next)=>{
    try{
      if(!Buffer.isBuffer(req.body)||!req.body.length) return res.status(400).json({ok:false,code:'EMPTY_AUDIO'});
      const text=await translator.transcribeAudio(req.body,req.get('content-type'),codeForLanguage(req.member.language)?.split('-')[0]);
      if(!text) return res.status(422).json({ok:false,code:'EMPTY_TRANSCRIPT'});res.json({ok:true,text});
    }catch(error){next(error);}
  });
  router.post('/:id/live/session',access,limiter,async(req,res)=>{
    try{
      const {sdp}=req.body||{};
      if(typeof sdp!=='string'||!sdp||sdp.length>200000) return res.status(400).json({ok:false,code:'INVALID_LIVE_SESSION'});
      const answer=await translator.createRealtimeTranscriptionCall(sdp,req.member.id);if(!answer) throw new Error('unavailable');res.json({ok:true,sdp:answer});
    }catch{res.status(503).json({ok:false,code:'LIVE_UNAVAILABLE'});}
  });
  return router;
}
module.exports={createSharedRouter};
