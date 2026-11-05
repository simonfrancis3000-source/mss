import test from "node:test";
import assert from "node:assert/strict";
import {
  createSmartThingsHomeConnect, encryptSmartThingsToken, decryptSmartThingsToken
} from "../server/smartthings-home-connect.js";

function response() {
  return {
    status: null, headers: {}, body: "",
    writeHead(status, headers = {}) { this.status = status; this.headers = headers; },
    end(body = "") { this.body = body; }
  };
}
const mockAuthFetch = async (url) => {
  assert.match(String(url), /\/auth\/v1\/user$/);
  return { ok: true, json: async () => ({ id: "00000000-0000-4000-8000-000000000001", email: "test@example.com" }) };
};
const req = (method, host = "synqme-api.onrender.com") => ({
  method,
  headers: { authorization: "Bearer test-supabase-jwt", host }
});
const options = {
  supabaseUrl: "https://project.supabase.co",
  publishableKey: "test-publishable",
  clientId: "client-id",
  clientSecret: "a-long-test-secret",
  redirectUri: "https://synqme-api.onrender.com/api/integrations/smartthings/callback",
  fetchImpl: mockAuthFetch
};

test("SmartThings OAuth tokens encrypt and authenticate at rest", () => {
  const value = "this is not a public token";
  const encrypted = encryptSmartThingsToken(value, "test-secret");
  assert.notEqual(encrypted, value);
  assert.equal(decryptSmartThingsToken(encrypted, "test-secret"), value);
  assert.throws(() => decryptSmartThingsToken(encrypted, "incorrect-secret"));
});

test("unconfigured integration fails closed", async () => {
  const route = createSmartThingsHomeConnect({ db: null, clientId: "", clientSecret: "" });
  const res = response();
  assert.equal(await route(req("GET"), res, new URL("http://localhost/api/integrations/smartthings/status")), true);
  assert.equal(res.status, 503);
});

test("signed-in user sees only sanitised connection status", async () => {
  const db = { from(table) {
    assert.equal(table, "mss_smartthings_connections");
    return { select() { return this; }, eq() { return this; }, maybeSingle: async () => ({
      data: { user_id: "uuid", devices: [{ label: "Kitchen light" }], synced_at: null, refresh_token_encrypted: "should-not-leak" },
      error: null
    }) };
  }};
  const route = createSmartThingsHomeConnect({ ...options, db });
  const res = response();
  assert.equal(await route(req("GET"), res, new URL("http://localhost/api/integrations/smartthings/status")), true);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).devices[0].label, "Kitchen light");
  assert.ok(!res.body.includes("should-not-leak"));
});

test("OAuth authorisation is limited to read scopes and API callback", async () => {
  let inserted;
  const db = { from(table) {
    assert.equal(table, "mss_smartthings_oauth_states");
    return { insert: async row => { inserted = row; return { error: null }; } };
  }};
  const route = createSmartThingsHomeConnect({ ...options, db });
  const res = response();
  assert.equal(await route(req("POST"), res, new URL("http://localhost/api/integrations/smartthings/start")), true);
  assert.equal(res.status, 200);
  const parsed = new URL(JSON.parse(res.body).authorizationUrl);
  assert.equal(parsed.origin, "https://api.smartthings.com");
  assert.equal(parsed.searchParams.get("scope"), "r:devices:* r:locations:*");
  assert.equal(parsed.searchParams.get("redirect_uri"), options.redirectUri);
  assert.ok(inserted.state_hash.length === 64);
  assert.ok(!JSON.stringify(inserted).includes(parsed.searchParams.get("state")));
});

test("wrong redirect host blocks authorisation before issuing state", async () => {
  const route = createSmartThingsHomeConnect({ ...options, db: { from() { throw Error("unexpected database call"); } } });
  const res = response();
  await route(req("POST", "synqme.mysecondself.app"), res, new URL("http://localhost/api/integrations/smartthings/start"));
  assert.equal(res.status, 503);
});

test("no device-command route exists", async () => {
  const db = { from() { throw Error("no database request expected"); } };
  const route = createSmartThingsHomeConnect({ ...options, db });
  const res = response();
  await route(req("POST"), res, new URL("http://localhost/api/integrations/smartthings/command"));
  assert.equal(res.status, 404);
});


test("Android connect starts with the same read-only Samsung scope and records native return client", async () => {
  let inserted;
  const db = { from(table) {
    assert.equal(table, "mss_smartthings_oauth_states");
    return { insert: async row => {inserted = row; return {error:null};} };
  }};
  const route = createSmartThingsHomeConnect({...options,db});
  const native = req("POST");
  native.headers["x-mss-connected-home-client"] = "android";
  const res = response();
  await route(native,res,new URL("http://localhost/api/integrations/smartthings/start"));
  assert.equal(res.status,200);
  assert.equal(inserted.return_client,"android");
  const authorization = new URL(JSON.parse(res.body).authorizationUrl);
  assert.equal(authorization.origin,"https://api.smartthings.com");
  assert.equal(authorization.searchParams.get("scope"),"r:devices:* r:locations:*");
  assert.equal(authorization.searchParams.get("redirect_uri"),options.redirectUri);
});

test("Samsung callback brings native Android app back without exposing tokens or changing read scopes", async () => {
  const db = { from(table) {
    assert.equal(table,"mss_smartthings_oauth_states");
    return {
      delete() {return this;},eq() {return this;},select() {return this;},
      maybeSingle:async()=>({data:{
        user_id:"00000000-0000-4000-8000-000000000001",
        expires_at:new Date(Date.now()+200000).toISOString(),
        return_client:"android"
      },error:null})
    };
  }};
  const route=createSmartThingsHomeConnect({...options,db});
  const res=response();
  await route(req("GET"),res,new URL(
    "http://localhost/api/integrations/smartthings/callback?state="+"a".repeat(43)+"&error=access_denied"
  ));
  assert.equal(res.status,303);
  assert.equal(res.headers.Location,"app.mysecondself://connected-home?smartthings=denied");
  assert.ok(!res.headers.Location.includes("state="));
});

test("browser SmartThings callback continues returning to web instead of native app", async () => {
  const db={from(){return{
    delete(){return this;},eq(){return this;},select(){return this;},
    maybeSingle:async()=>({data:{user_id:"owner",expires_at:new Date(Date.now()+200000).toISOString(),return_client:"web"},error:null})
  };}};
  const route=createSmartThingsHomeConnect({...options,db});
  const res=response();
  await route(req("GET"),res,new URL(
    "http://localhost/api/integrations/smartthings/callback?state="+"b".repeat(43)+"&error=denied"
  ));
  assert.equal(res.status,303);
  assert.equal(res.headers.Location,"https://synqme.mysecondself.app/?smartthings=denied");
});
