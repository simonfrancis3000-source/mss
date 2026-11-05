import { createPublicKey, verify } from 'node:crypto';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
let cachedJwks = null;
let keysExpireAt = 0;

function reject(code) {
  const error = new Error(code);
  error.statusCode = 401;
  return error;
}

function parseJson64(raw) {
  try { return JSON.parse(Buffer.from(raw,'base64url').toString('utf8')); }
  catch { throw reject('invalid_pubsub_token'); }
}

/** Authenticate the Google-managed OIDC identity of the push subscription. */
export async function verifyGooglePubSubPush(bearer, {
  audience, serviceAccountEmail, fetchImpl = fetch, now = Date.now()
}={}) {
  if (!audience || !serviceAccountEmail) throw reject('pubsub_not_configured');
  const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(String(bearer || ''));
  if (!match) throw reject('missing_pubsub_identity');
  const token = match[1];
  if (token.length > 16000) throw reject('invalid_pubsub_token');
  const [h,p,s] = token.split('.');
  const header = parseJson64(h);
  const claims = parseJson64(p);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw reject('invalid_pubsub_algorithm');
  if (!['https://accounts.google.com','accounts.google.com'].includes(claims.iss) ||
      claims.aud !== audience ||
      claims.email !== serviceAccountEmail ||
      claims.email_verified !== true ||
      typeof claims.sub !== 'string' || !claims.sub ||
      !Number.isFinite(claims.exp) || !Number.isFinite(claims.iat) ||
      claims.exp*1000 <= now || claims.iat*1000 > now+60000 ||
      claims.iat*1000 < now-3600000) {
    throw reject('invalid_pubsub_claims');
  }

  if (!cachedJwks || now >= keysExpireAt || !cachedJwks.keys?.some(k=>k.kid===header.kid)) {
    const response = await fetchImpl(GOOGLE_JWKS,{signal:AbortSignal.timeout(10000)});
    if (!response.ok) throw reject('pubsub_keys_unavailable');
    const keys = await response.json();
    if (!Array.isArray(keys?.keys)) throw reject('pubsub_keys_unavailable');
    cachedJwks = keys;
    keysExpireAt = now + 20*60000;
  }
  const key = cachedJwks.keys.find(k=>k.kid===header.kid && k.kty==='RSA' && k.use==='sig');
  if (!key) throw reject('unknown_pubsub_key');
  let valid = false;
  try {
    valid = verify('RSA-SHA256',Buffer.from(h+'.'+p),
      createPublicKey({key,format:'jwk'}),Buffer.from(s,'base64url'));
  } catch { /* invalid signature */ }
  if (!valid) throw reject('invalid_pubsub_signature');
  return {email:claims.email,subject:claims.sub};
}

/** Parse only the signed subscription-change signal, not arbitrary purchases. */
export function parseGooglePlayRtdn(body) {
  if (!body || !body.message || typeof body.message.data !== 'string' ||
      body.message.data.length>12000) throw reject('invalid_rtdn_message');
  let message;
  try { message=JSON.parse(Buffer.from(body.message.data,'base64').toString('utf8')); }
  catch { throw reject('invalid_rtdn_payload'); }
  if (message?.packageName !== 'app.mysecondself') throw reject('wrong_rtdn_package');
  const purchaseToken = message?.subscriptionNotification?.purchaseToken;
  if (typeof purchaseToken!=='string' || purchaseToken.length<20 || purchaseToken.length>8192) {
    throw reject('invalid_rtdn_subscription');
  }
  return {purchaseToken,notificationType:message.subscriptionNotification.notificationType||0};
}
