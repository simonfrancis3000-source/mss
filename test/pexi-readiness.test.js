import test from "node:test";
import assert from "node:assert/strict";
import { buildPexiCapabilityPlan, PEXI_SUPPORTED_TASKS } from "../src/pexi-readiness.js";

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
      manufacturer: "Example Robotics",
      model: "XR-2",
      completeness: "partial",
      capabilities: ["textile_recognition"]
    }
  });
  assert.equal(plan.tasks[0].capability_status, "partially_verified");
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
