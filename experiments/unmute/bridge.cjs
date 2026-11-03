'use strict';
// MySecondSelf to Unmute bridge, isolated Runpod evaluation only.
// Public :3000 -> authenticated Next.js + Unmute backend; private :8093 -> OpenAI-compatible AMIA adapter.
// No persistent account credentials, no service-role credentials, no production code changes.
const http = require('node:http');
const crypto = require('node:crypto');
const httpProxy = require('http-proxy');

const SUPABASE_URL = 'https://ltqbjqtzsdzglswuqkip.supabase.co';
const PUB_KEY = process.env.MSS_SUPABASE_PUBLISHABLE_KEY || '';
const TURNSTILE_SITE_KEY = process.env.MSS_TURNSTILE_SITE_KEY || '0x4AAAAAAFxQtK2-J-A-K9oc';
const AMIA_URL = 'https://synqme-api.onrender.com/api/chat';
const SESSIONS = new Map();
let activeSessionId = null;
const LOGIN_ATTEMPTS = new Map();
const LIVE_SESSION_TTL_MS = 6 * 60 * 60 * 1000;
const VOICE_NAME = 'unmute-prod-website/default_voice.wav';
const FUNCTIONS = {
  'dishwashing': 'Dishwashing', 'vacuuming': 'Vacuuming & floors', 'laundry': 'Laundry',
  'folding': 'Folding & putting away', 'tidying': 'Tidying', 'surfaces': 'Surface cleaning',
  'meal-prep': 'Meal preparation', 'cooking': 'Cooking', 'groceries': 'Groceries & supplies',
  'pet-care': 'Pet care', 'plants': 'Plant care', 'recycling': 'Waste & recycling'
};
const VOICES = [{
  name: 'MSS Test', good: true,
  instructions: { type: 'smalltalk', language: 'en' },
  source: { source_type: 'file', path_on_server: VOICE_NAME, description: 'Single-voice AMIA test' }
}];

function respond(res, status, payload, extra = {}) {
  const body = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': typeof payload === 'string' ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...extra });
  res.end(body);
}
function error(res, status, message) { respond(res, status, { error: message }); }
function escapeHtml(v) { return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function getCookie(req) {
  const cookie = String(req.headers.cookie || '');
  const match = /(?:^|;\s*)mss_voice_test=([a-f0-9]{64})(?:;|$)/.exec(cookie);
  return match?.[1] || '';
}
function sessionFor(req) {
  const key = getCookie(req);
  const session = SESSIONS.get(key);
  if (!session || key !== activeSessionId || Date.now() - session.startedAt > LIVE_SESSION_TTL_MS) return null;
  return session;
}
function sessionCookie(sid, maxAge=21600) {
  return `mss_voice_test=${sid}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
async function readBody(req, limit=16384) {
  let content = '';
  for await (const chunk of req) {
    content += chunk.toString('utf8');
    if (content.length > limit) throw new Error('Request too large');
  }
  return content;
}
async function jsonRequest(url, options={}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const result = await response.json().catch(() => ({}));
    return { status: response.status, ok: response.ok, data: result };
  } finally { clearTimeout(timeout); }
}
function supaHeaders(token) { return { apikey: PUB_KEY, Authorization: `Bearer ${token}`, Accept: 'application/json' }; }
async function refreshToken(session) {
  if (Date.now() < session.expiresAt - 60_000) return;
  const out = await jsonRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST', headers: { apikey: PUB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ refresh_token: session.refreshToken })
  });
  if (!out.ok || !out.data.access_token) throw new Error('MSS session expired; please sign in again.');
  session.token = out.data.access_token;
  session.refreshToken = out.data.refresh_token;
  session.expiresAt = Date.now() + (Number(out.data.expires_in || 3600) * 1000);
}
async function readUserContext(session) {
  await refreshToken(session);
  const id = encodeURIComponent(session.userId);
  const suffix = `?user_id=eq.${id}&select=*`;
  const urls = [
    `${SUPABASE_URL}/rest/v1/synqme_profiles${suffix}`,
    `${SUPABASE_URL}/rest/v1/synqme_preferences${suffix}&order=created_at.desc&limit=24`,
    `${SUPABASE_URL}/rest/v1/synqme_conversations${suffix}`
  ];
  const results = await Promise.all(urls.map(url => jsonRequest(url, { headers: supaHeaders(session.token) })));
  for (const result of results) if (!result.ok) throw new Error(`Supabase profile request failed: ${result.status}`);
  const p = results[0].data[0] || {};
  const prefs = results[1].data || [];
  const history = results[2].data[0]?.messages || [];
  return {
    profile: {
      ownerName: p.owner_name || '', companionName: p.future_robot_name || 'Freya',
      robotName: p.future_robot_name || '', robotType: p.future_robot_type || 'Humanoid robot',
      robotVoice: p.future_robot_voice || 'female', preferredLanguage: p.preferred_language || 'en',
      askBeforeActions: Boolean(p.confirm_actions)
    },
    preferences: prefs.map(item => ({
      category: item.category || 'Personal preference', text: item.preference_text || '',
      epistemicStatus: item.preference_status || 'user_stated',
      explicitFields: item.explicit_facets || {}, unresolvedFields: item.unresolved_fields || []
    })),
    domesticFunctions: (Array.isArray(p.domestic_functions) ? p.domestic_functions : [])
      .map(id => FUNCTIONS[id]).filter(Boolean),
    history: Array.isArray(history) ? history.filter(m => ['assistant','user'].includes(m.role) && typeof m.content === 'string') : []
  };
}
function prepareMessages(history, unmuteMessages) {
  const recent = (Array.isArray(unmuteMessages) ? unmuteMessages : [])
    .filter(x => ['user','assistant'].includes(x.role) && typeof x.content === 'string' && x.content.trim())
    .map(x => ({ role: x.role, content: x.content.trim().slice(0,1200) }));
  // The Unmute default bootstrap can insert a dummy 'Hello.' when the system prompt is followed by an assistant turn.
  if (recent.length > 1 && recent[0].role === 'user' && recent[0].content === 'Hello.' && recent[1].role === 'assistant') recent.shift();
  const past = history.slice(-14).map(x => ({ role:x.role, content:x.content.trim().slice(0,1200) }));
  // Drop the largest exact overlapping portion so a session continuation doesn't duplicate messages.
  let overlap = 0;
  for (let n = 1; n <= Math.min(past.length,recent.length); n++) {
    if (JSON.stringify(past.slice(-n)) === JSON.stringify(recent.slice(0,n))) overlap = n;
  }
  const merged = [...past, ...recent.slice(overlap)].slice(-18);
  // AMIA requires the final message to be a real user turn.
  if (!merged.length || merged.at(-1).role !== 'user') return [];
  const last = merged.at(-1).content;
  if (last === '...' || last === 'Hello.' && merged.length === 1) return [];
  return merged;
}
async function completeWithAmia(payload) {
  const session = SESSIONS.get(activeSessionId);
  if (!session || Date.now() - session.startedAt > LIVE_SESSION_TTL_MS) throw new Error('Sign in at /mss/login to connect AMIA.');
  const context = await readUserContext(session);
  const messages = prepareMessages(context.history, payload.messages);
  if (!messages.length) return 'I am ready to continue our MySecondSelf training. What would you like to work on?';
  const out = await jsonRequest(AMIA_URL, {
    method:'POST', headers: { Authorization:`Bearer ${session.token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ messages, profile:context.profile, preferences:context.preferences,
      domesticFunctions:context.domesticFunctions, outputMode:'spoken', repairMode:false })
  });
  if (!out.ok) throw new Error(`AMIA API returned ${out.status}: ${String(out.data.error || 'Request failed').slice(0,180)}`);
  if (typeof out.data.reply !== 'string' || !out.data.reply.trim()) throw new Error('AMIA returned an empty reply');
  return out.data.reply.trim();
}
function loginPage(message='') {
  // The actual public Turnstile SITE key is safe to expose; the secret is never present here.
  return `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta charset="utf-8" /><title>MySecondSelf / Unmute Test Login</title>
  <script>window.mssTurnstileError=function(code){var e=document.getElementById('mssTurnstileStatus');if(e)e.textContent='Turnstile challenge error: '+String(code).replace(/[^0-9]/g,'').slice(0,10)+'. Reload the page to retry.';return false;};</script>
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
  <style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101218;color:#eff1f4;font:16px system-ui,sans-serif}
  main{width:min(90vw,430px);padding:36px;border:1px solid #39424b;border-radius:20px;background:#191d25}
  h1{font-size:27px;margin:0 0 10px}p{color:#b1bac4;line-height:1.5}input{box-sizing:border-box;width:100%;padding:13px;margin:8px 0 18px;border:1px solid #64717a;border-radius:8px;background:#0c0f13;color:#fff}
  button{border:0;border-radius:10px;width:100%;padding:14px;background:#5be6b9;color:#08120e;font-weight:800;cursor:pointer;margin-top:18px}
  .error{color:#ffb7ba}small{color:#b1bac4}</style></head><body><main><h1>MySecondSelf + Unmute</h1>
  <p>Sign in to your existing MySecondSelf account. This private test will read your training history and ask the next question through AMÏA, using Kyutai's speech technology.</p>
  ${message?`<p class="error">${escapeHtml(message)}</p>`:''}
  <form method="post" action="/mss/login"><label>Email<input type="email" name="email" required autocomplete="email"></label>
  <label>Password<input type="password" name="password" required autocomplete="current-password"></label>
  <div class="cf-turnstile" data-sitekey="${escapeHtml(TURNSTILE_SITE_KEY)}" data-error-callback="mssTurnstileError"></div><p id="mssTurnstileStatus" class="error" role="status" aria-live="polite"></p>
  <button type="submit">Sign in and start voice test</button></form>
  <p><small>Experimental Runpod test. The live Phonic app is unchanged. New spoken answers are not saved to MSS during this first test.</small></p>
  </main></body></html>`;
}

const proxy = httpProxy.createProxyServer({ ws:true, changeOrigin:true });
proxy.on('error', (err, req, res) => {
  console.error('Proxy failure:', err.message);
  if(res?.writeHead && !res.headersSent) error(res,502,'Temporary upstream failure');
  else if(res?.destroy) res.destroy();
});

const publicServer = http.createServer(async (req,res) => {
  try {
    if(!PUB_KEY) return error(res,503,'MSS_SUPABASE_PUBLISHABLE_KEY not configured');
    const path = new URL(req.url, 'http://localhost').pathname;
    if(path==='/mss/login' && req.method==='GET') return respond(res,200,loginPage(),{'Content-Type':'text/html; charset=utf-8'});
    if(path==='/mss/login' && req.method==='POST') {
      const origin=req.headers.origin;
      if(origin && new URL(origin).host !== req.headers.host) return error(res,403,'Invalid request origin');
      const ip=String(req.headers['x-forwarded-for']||req.socket.remoteAddress||'unknown').split(',')[0];
      const attempts=LOGIN_ATTEMPTS.get(ip)||{start:Date.now(),count:0};
      if(Date.now()-attempts.start>60000){attempts.start=Date.now();attempts.count=0;}
      attempts.count++;LOGIN_ATTEMPTS.set(ip,attempts);
      if(attempts.count>5) return respond(res,429,loginPage('Too many attempts. Try again shortly.'),{'Content-Type':'text/html; charset=utf-8'});
      const body=await readBody(req);
      const data=new URLSearchParams(body);
      const email=String(data.get('email')||'').trim().toLowerCase();
      const password=String(data.get('password')||'');
      const captcha=String(data.get('cf-turnstile-response')||'');
      if(!email || !password || !captcha) return respond(res,400,loginPage('Complete the email, password and security check.'),{'Content-Type':'text/html; charset=utf-8'});
      const auth=await jsonRequest(`${SUPABASE_URL}/auth/v1/token?grant_type=password`,{
        method:'POST', headers: { apikey:PUB_KEY, 'Content-Type':'application/json' },
        body:JSON.stringify({email,password,gotrue_meta_security:{captcha_token:captcha}})
      });
      if(!auth.ok || !auth.data.access_token || !auth.data.user?.id || auth.data.user.is_anonymous) {
        const authCode=String(auth.data?.code||auth.data?.error_code||auth.data?.error||'unknown').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,70);
        console.error('MSS login rejected by Supabase Auth; HTTP status:',auth.status,'error code:',authCode);
        const humanMessage = /captcha|turnstile/i.test(authCode)
          ? 'Supabase rejected the Turnstile verification (code: '+authCode+'). Reload and try a fresh challenge.'
          : 'Supabase rejected sign-in (HTTP '+auth.status+', code: '+authCode+'). Check your account credentials and verification.';
        return respond(res,401,loginPage(humanMessage),{'Content-Type':'text/html; charset=utf-8'});
      }
      const sid=crypto.randomBytes(32).toString('hex');
      SESSIONS.clear();
      SESSIONS.set(sid,{userId:auth.data.user.id,token:auth.data.access_token,
        refreshToken:auth.data.refresh_token,expiresAt:Date.now()+Number(auth.data.expires_in||3600)*1000,
        startedAt:Date.now()});
      activeSessionId=sid;
      console.info('MSS test account authenticated. User identifier withheld.');
      res.writeHead(303,{'Location':'/','Set-Cookie':sessionCookie(sid),'Cache-Control':'no-store'});
      return res.end();
    }
    const current=sessionFor(req);
    if(path==='/mss/logout' && req.method==='POST') {
      const sid=getCookie(req);
      SESSIONS.delete(sid);if(activeSessionId===sid)activeSessionId=null;
      res.writeHead(303,{'Location':'/mss/login','Set-Cookie':sessionCookie('',0),'Cache-Control':'no-store'});
      return res.end();
    }
    if(!current){res.writeHead(302,{'Location':'/mss/login','Cache-Control':'no-store'});return res.end();}
    if(path==='/mss/status'){
      const ctx=await readUserContext(current);
      return respond(res,200,{ok:true,source:'MySecondSelf',robotName:ctx.profile.robotName,
        priorMessages:ctx.history.length,preferences:ctx.preferences.length,
        functions:ctx.domesticFunctions.length,writeBack:false});
    }
    if(path==='/api/v1/voices') return respond(res,200,VOICES);
    if(path==='/api' || path.startsWith('/api/')) {
      req.url=req.url.slice(4)||'/';
      return proxy.web(req,res,{target:'http://127.0.0.1:8000'});
    }
    return proxy.web(req,res,{target:'http://127.0.0.1:3002'});
  } catch(e) {
    console.error('MSS proxy error:',e.message);
    if(!res.headersSent) error(res,500,'MSS test failed; check Runpod bridge logs');
    else res.destroy();
  }
});
publicServer.on('upgrade',(req,socket,head)=>{
  if(!sessionFor(req)){socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return socket.destroy();}
  if(req.url.startsWith('/api/')) {
    req.url=req.url.slice(4);
    return proxy.ws(req,socket,head,{target:'ws://127.0.0.1:8000'});
  }
  return proxy.ws(req,socket,head,{target:'ws://127.0.0.1:3002'});
});

const localLLM=http.createServer(async(req,res)=>{
  try {
    const path=new URL(req.url,'http://localhost').pathname;
    if(path==='/v1/models')return respond(res,200,{object:'list',data:[{id:'mss-amia',object:'model',created:0,owned_by:'MySecondSelf'}]});
    if(path!=='/v1/chat/completions' || req.method!=='POST')return error(res,404,'Unknown path');
    const payload=JSON.parse(await readBody(req,65536));
    const reply=await completeWithAmia(payload);
    const msgId='chatcmpl-'+crypto.randomUUID();
    const timestamp=Math.floor(Date.now()/1000);
    if(payload.stream){
      res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Cache-Control':'no-cache, no-transform',Connection:'keep-alive','X-Accel-Buffering':'no'});
      res.write(`data: ${JSON.stringify({id:msgId,object:'chat.completion.chunk',created:timestamp,model:'mss-amia',choices:[{index:0,delta:{role:'assistant'},finish_reason:null}]})}\n\n`);
      for(const match of reply.matchAll(/\S+\s*/g)){
        const chunk={id:msgId,object:'chat.completion.chunk',created:timestamp,model:'mss-amia',choices:[{index:0,delta:{content:match[0]},finish_reason:null}]};
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write(`data: ${JSON.stringify({id:msgId,object:'chat.completion.chunk',created:timestamp,model:'mss-amia',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\n`);
      res.end('data: [DONE]\n\n');
    } else {
      return respond(res,200,{id:msgId,object:'chat.completion',created:timestamp,model:'mss-amia',
        choices:[{index:0,message:{role:'assistant',content:reply},finish_reason:'stop'}]});
    }
  } catch(e){
    console.error('MSS AMIA adapter:',e.message);
    if(!res.headersSent)error(res,502,e.message);
    else res.end();
  }
});
localLLM.listen(8093,'127.0.0.1',()=>console.log('MSS AMIA OpenAI-compatible adapter bound to local 127.0.0.1:8093'));
publicServer.listen(3000,'0.0.0.0',()=>console.log('MSS protected Unmute browser bound to port 3000'));