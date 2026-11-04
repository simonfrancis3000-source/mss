import test from "node:test";
import assert from "node:assert/strict";
import {betaTesterEmailSet,betaTesterIsEligible,ensureBetaVoiceAllowance} from "../server/voice-beta-allowance.js";
test("beta list is case-insensitive and ignores empty entries", () => {
  const list=betaTesterEmailSet(" TESTER@example.com, ,tester@example.com,other@example.com ");
  assert.equal(list.size,2);
  assert.equal(betaTesterIsEligible({id:"user-1",email:"tester@EXAMPLE.com"},list),true);
  assert.equal(betaTesterIsEligible({id:"user-1",email:"not-allowed@example.com"},list),false);
  assert.equal(betaTesterIsEligible({email:"tester@example.com"},list),false);
});
test("only eligible signed-in accounts can invoke the grant RPC", async () => {
  const allowlist=betaTesterEmailSet("tester@example.com");
  const seen=[];
  const db={rpc:async (name, args)=>{seen.push({name,args});return {data:seen.length===1,error:null}}};
  assert.equal(await ensureBetaVoiceAllowance({db,user:{id:"a1",email:"other@example.com"},allowlist}),false);
  assert.equal(seen.length,0);
  assert.equal(await ensureBetaVoiceAllowance({db,user:{id:"a1",email:"tester@example.com"},allowlist}),true);
  assert.equal(await ensureBetaVoiceAllowance({db,user:{id:"a1",email:"tester@example.com"},allowlist}),false);
  assert.deepEqual(seen,[{name:"mss_grant_beta_voice_allowance",args:{p_user_id:"a1"}},{name:"mss_grant_beta_voice_allowance",args:{p_user_id:"a1"}}]);
});
test("provisioning failures are not mistaken for available voice credits", async () => {
  const allowlist=betaTesterEmailSet("tester@example.com");
  await assert.rejects(()=>ensureBetaVoiceAllowance({db:{rpc:async()=>({error:{code:"XX"}})},user:{id:"a1",email:"tester@example.com"},allowlist}),/Could not provision/);
});
