import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanSimulationResult, simulationCapabilitySummary } from '../src/simulation.js';

const memory = { id: 'm1', statement: 'Leave my papers on the coffee table.', status: 'user_confirmed', conditions: [], permission_policy: 'prohibited' };
const preview = { situation: 'Papers are on the coffee table.', proposed_response: 'I would leave your papers where they are.', evidence_ids: ['m1'], follow_up_question: '' };
const manifest = { schema:'app.mysecondself.pexi-capability-manifest',schema_version:'1.0.0',manufacturer:'Example',model:'R1',source:'Supplier document',completeness:'complete',capabilities:['object_recognition','object_pick_and_place','spatial_memory','user_permission_enforcement'],declared_safety_gates:[] };

test('situation response cites only saved supplied evidence', () => {
  const result = cleanSimulationResult(preview, [memory]);
  assert.equal(result.proposed_response, preview.proposed_response);
  assert.equal(result.sources[0].statement, memory.statement);
  assert.equal(result.evidence_status, 'based_on_saved_preferences');
  assert.equal(cleanSimulationResult({ ...preview, evidence_ids:['invented'] }, [memory]), null);
});

test('a simulation without relevant evidence asks instead of inventing a preference', () => {
  const result = cleanSimulationResult({ ...preview, proposed_response:'You asked me to move everything.', evidence_ids:[] }, []);
  assert.match(result.proposed_response, /don't have a linked preference/);
  assert.doesNotMatch(result.proposed_response, /move everything/);
  assert.equal(result.evidence_status, 'needs_information');
  assert.equal(result.follow_up_question, 'How would you like me to handle this situation?');
});

test('capability descriptions distinguish unknown, declared and missing without claiming verification', () => {
  assert.equal(simulationCapabilitySummary({ functionId:'tidying' }).state, 'unknown');
  const declared = simulationCapabilitySummary({ functionId:'tidying', manifest });
  assert.equal(declared.state, 'declared'); assert.match(declared.text,/not been independently verified/);
  const incomplete = { ...manifest, capabilities:['object_recognition'] };
  assert.equal(simulationCapabilitySummary({ functionId:'tidying', manifest:incomplete }).state, 'not_declared');
  assert.equal(simulationCapabilitySummary({ functionId:'tidying', manifest:{ ...incomplete, completeness:'partial' } }).state, 'unknown');
  assert.equal(simulationCapabilitySummary({ functionId:'invented', manifest }).state, 'not_assessed');
});
