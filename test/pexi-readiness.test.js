import test from "node:test";
import assert from "node:assert/strict";
import { buildPexiCapabilityPlan, cleanPexiCapabilityManifest, PEXI_SUPPORTED_TASKS } from "../src/pexi-readiness.js";

test("maps all supported home functions to a capability and safety brief", () => {
  const plan = buildPexiCapabilityPlan({
    selectedFunctions: PEXI_SUPPORTED_TASKS,
    preferences: [{ text: "Please leave the fragile glasses where they are.", category: "Safety", status: "user_confirmed" }]
  });
  assert.equal(plan.task_count, PEXI_SUPPORTED_TASKS.length);
  assert.equal(plan.status, "awaiting_robot_specification");
  assert.ok(plan.tasks.every((task) => task.required_capabilities.length > 0));
  assert.ok(plan.tasks.every((task) => task.safety_gates.length > 0));
  assert.equal(plan.execution_contract.compatibility_claimed, false);
  assert.equal(plan.execution_contract.physical_actions_enabled, false);
});

test("does not infer robot compatibility from a generic robot type", () => {
  const plan = buildPexiCapabilityPlan({
    selectedFunctions: ["dishwashing", "tidying"],
    targetRobotType: "Humanoid robot"
  });
  assert.equal(plan.target_robot.capability_manifest_status, "not_supplied");
  assert.ok(plan.tasks.every((task) => task.capability_status === "unverified"));
  assert.equal(plan.status, "awaiting_robot_specification");
});

test("compares declared capabilities while keeping missing safety checks visible", () => {
  const plan = buildPexiCapabilityPlan({
    selectedFunctions: ["dishwashing"],
    capabilityManifest: {
      schema: "app.mysecondself.pexi-capability-manifest",
      schema_version: "1.0.0",
      manufacturer: "Example Robotics",
      model: "XR-1",
      source: "Manufacturer capability declaration",
      completeness: "complete",
      capabilities: ["object_recognition", "object_pick_and_place", "dishwasher_interaction"]
    }
  });
  assert.equal(plan.target_robot.model, "XR-1");
  assert.equal(plan.tasks[0].capability_status, "missing_capabilities");
  assert.deepEqual(plan.tasks[0].missing_capabilities, ["controlled_force"]);
  assert.ok(plan.tasks[0].unverified_safety_gates.length > 0);
  assert.equal(plan.execution_contract.compatibility_claimed, false);
});

test("partial manifests do not treat omitted capability declarations as unsupported", () => {
  const plan = buildPexiCapabilityPlan({
    selectedFunctions: ["laundry"],
    capabilityManifest: {
      schema: "app.mysecondself.pexi-capability-manifest",
      schema_version: "1.0.0",
      manufacturer: "Example Robotics",
      model: "XR-2",
      source: "Manufacturer capability draft",
      completeness: "partial",
      capabilities: ["textile_recognition"]
    }
  });
  assert.equal(plan.tasks[0].capability_status, "partially_verified");
  assert.equal(plan.status, "capabilities_not_fully_declared");
  assert.equal(plan.target_robot.manifest_verification_status, "not_independently_verified");
  assert.ok(plan.tasks[0].unverified_capabilities.includes("garment_manipulation"));
  assert.deepEqual(plan.tasks[0].missing_capabilities, []);
});

test("unresolved preferences block a complete persona brief without losing the task map", () => {
  const plan = buildPexiCapabilityPlan({
    selectedFunctions: ["laundry"],
    preferences: [{ text: "Wash my clothes twice a week.", unresolvedFields: ["temperature"] }]
  });
  assert.equal(plan.status, "persona_details_open");
  assert.equal(plan.totals.unresolved_preference_details, 1);
  assert.equal(plan.tasks[0].persona_preferences.length, 1);
  assert.ok(plan.tasks[0].persona_preferences[0].unresolved_fields.includes("temperature"));
});


test("accepts only the versioned manufacturer capability manifest schema", () => {
  const manifest = cleanPexiCapabilityManifest({
    schema: "app.mysecondself.pexi-capability-manifest",
    schema_version: "1.0.0",
    manufacturer: " Example Robotics ",
    model: " XR-3 ",
    source: "https://example.com/xr-3/capabilities",
    completeness: "partial",
    capabilities: ["object_recognition", "OBJECT_RECOGNITION", "move_to_pose"],
    declared_safety_gates: ["water_and_electrical_safety"]
  });
  assert.equal(manifest.manufacturer, "Example Robotics");
  assert.deepEqual(manifest.capabilities, ["object_recognition", "move_to_pose"]);
  assert.deepEqual(manifest.declared_safety_gates, ["water_and_electrical_safety"]);
  assert.equal(cleanPexiCapabilityManifest({ ...manifest, schema_version: "2.0.0" }), null);
  assert.equal(cleanPexiCapabilityManifest({ schema: manifest.schema, schema_version: "1.0.0" }), null);
});

test("supplier declarations remain unverified even when all required capabilities are listed", () => {
  const manifest = {
    schema: "app.mysecondself.pexi-capability-manifest",
    schema_version: "1.0.0",
    manufacturer: "Example Robotics",
    model: "XR-4",
    source: "Manufacturer capability declaration",
    completeness: "complete",
    capabilities: ["object_recognition", "object_pick_and_place", "dishwasher_interaction", "controlled_force"],
    declared_safety_gates: ["glass_and_ceramic_handling", "water_and_electrical_safety", "rack_and_door-clearance"]
  };
  const plan = buildPexiCapabilityPlan({ selectedFunctions: ["dishwashing"], capabilityManifest: manifest });
  assert.equal(plan.tasks[0].capability_status, "capability_match_safety_review_required");
  assert.equal(plan.target_robot.manifest_verification_status, "not_independently_verified");
  assert.equal(plan.execution_contract.compatibility_claimed, false);
  assert.ok(plan.tasks[0].unverified_safety_gates.length > 0);
  assert.equal(plan.status, "safety_validation_required");
});
