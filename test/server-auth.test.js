import test from "node:test";
import assert from "node:assert/strict";
import { authenticateSupabaseRequest, rateLimitIdentity } from "../server/supabase-auth.js";

test("requires a bearer session and never accepts a publishable key as the user token", async () => {
  let called = false;
  const result = await authenticateSupabaseRequest({ headers: { authorization: "" } }, {
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_example",
    fetchImpl: async () => { called = true; throw new Error("should not run"); }
  });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(called, false);
});

test("verifies the session with Supabase Auth and returns only the authenticated subject", async () => {
  let request;
  const result = await authenticateSupabaseRequest({ headers: { authorization: "Bearer user-access-token" } }, {
    supabaseUrl: "https://example.supabase.co/",
    publishableKey: "sb_publishable_public",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return new Response(JSON.stringify({ id: "user-123", email: "user@example.com", is_anonymous: false }), { status: 200 });
    }
  });
  assert.equal(result.ok, true);
  assert.equal(result.user.id, "user-123");
  assert.equal(result.accessToken, "user-access-token");
  assert.equal(request.url, "https://example.supabase.co/auth/v1/user");
  assert.equal(request.options.headers.apikey, "sb_publishable_public");
  assert.equal(request.options.headers.Authorization, "Bearer user-access-token");
});

test("rejects anonymous sessions and invalid upstream credentials", async () => {
  const anonymous = await authenticateSupabaseRequest({ headers: { authorization: "Bearer anon-token" } }, {
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "public",
    fetchImpl: async () => new Response(JSON.stringify({ id: "anon-user", is_anonymous: true }), { status: 200 })
  });
  const invalid = await authenticateSupabaseRequest({ headers: { authorization: "Bearer expired" } }, {
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "public",
    fetchImpl: async () => new Response("{}", { status: 401 })
  });
  assert.equal(anonymous.status, 401);
  assert.equal(invalid.status, 401);
});

test("rate limits use the verified user id instead of trusting forwarded IP headers", () => {
  assert.equal(rateLimitIdentity("user-123", "203.0.113.7"), "user:user-123");
  assert.equal(rateLimitIdentity("", "203.0.113.7"), "ip:203.0.113.7");
});
