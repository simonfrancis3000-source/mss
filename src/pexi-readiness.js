const TASK_PROFILES = Object.freeze({
  dishwashing: {
    label: "Dishwashing",
    topics: ["kitchen"],
    requiredCapabilities: ["object_recognition", "object_pick_and_place", "dishwasher_interaction", "controlled_force"],
    safetyGates: ["glass_and_ceramic_handling", "water_and_electrical_safety", "rack_and_door_clearance"],
    preferenceTerms: /dish|plate|cup|mug|glass|bowl|cutlery|kitchen|rack|dishwasher/i
  },
  vacuuming: {
    label: "Vacuuming & floors",
    topics: ["vacuuming", "living_room", "bedroom"],
    requiredCapabilities: ["mobile_navigation", "floor_surface_detection", "cleaning_tool_interface", "obstacle_avoidance"],
    safetyGates: ["cable_and_trip_hazard_detection", "stairs_and_edge_protection", "pet_aware_navigation"],
    preferenceTerms: /vacuum|hoover|floor|carpet|rug|cable|pet hair|mop/i
  },
  laundry: {
    label: "Laundry",
    topics: ["laundry"],
    requiredCapabilities: ["textile_recognition", "garment_manipulation", "washer_dryer_interaction", "garment_care_instruction_reading"],
    safetyGates: ["heat_and_water_safety", "fabric_damage_prevention", "unknown_garment_isolation"],
    preferenceTerms: /laundry|wash|dry|fabric|clothes|garment|detergent|temperature|delicate/i
  },
  folding: {
    label: "Folding & putting away",
    topics: ["laundry", "bedroom"],
    requiredCapabilities: ["textile_manipulation", "garment_state_estimation", "folding_manipulation", "storage_location_mapping"],
    safetyGates: ["personal_item_handling", "unknown_item_isolation"],
    preferenceTerms: /fold|put away|wardrobe|drawer|shelf|clothes|storage/i
  },
  tidying: {
    label: "Tidying",
    topics: ["privacy_and_boundaries", "living_room", "bedroom"],
    requiredCapabilities: ["object_recognition", "object_pick_and_place", "spatial_memory", "user_permission_enforcement"],
    safetyGates: ["personal_and_private_item_protection", "fragile_item_protection", "unknown_destination_hold"],
    preferenceTerms: /tidy|organis(e|ing|ation)|organiz(e|ing|ation)|move|belonging|personal item|desk|storage|put away/i
  },
  surfaces: {
    label: "Surface cleaning",
    topics: ["surface_cleaning", "cleaning_supplies", "kitchen", "bathroom"],
    requiredCapabilities: ["surface_material_recognition", "cleaning_tool_manipulation", "dispensing_control", "force_control"],
    safetyGates: ["chemical_and_surface_compatibility", "liquid_and_electrical_safety", "no_spray_on_unknown_material"],
    preferenceTerms: /surface|worktop|counter|wipe|dust|polish|spray|cleaning product|cloth/i
  },
  "meal-prep": {
    label: "Meal preparation",
    topics: ["food_and_meals", "kitchen"],
    requiredCapabilities: ["food_object_recognition", "food_safe_manipulation", "measuring_and_portioning", "kitchen_tool_interaction"],
    safetyGates: ["food_hygiene", "allergen_and_dietary_constraint_handling", "sharp_and_hot_surface_safety"],
    preferenceTerms: /meal|prepare|ingredient|breakfast|lunch|dinner|portion|food/i
  },
  cooking: {
    label: "Cooking",
    topics: ["food_and_meals", "kitchen"],
    requiredCapabilities: ["food_object_recognition", "cooktop_and_oven_interaction", "temperature_monitoring", "kitchen_tool_manipulation"],
    safetyGates: ["fire_and_heat_safety", "food_hygiene", "sharp_tool_safety"],
    preferenceTerms: /cook|cooking|hob|stove|oven|pan|recipe|temperature|food/i
  },
  groceries: {
    label: "Groceries & supplies",
    topics: ["food_and_meals", "kitchen"],
    requiredCapabilities: ["item_identification", "inventory_tracking", "expiry_and_label_reading", "shelf_and_fridge_placement"],
    safetyGates: ["food_storage_and_expiry_checks", "allergen_constraint_preservation"],
    preferenceTerms: /grocer|shopping|supply|stock|fridge|pantry|expiry|food/i
  },
  "pet-care": {
    label: "Pet care",
    topics: ["pets"],
    requiredCapabilities: ["pet_detection", "pet_safe_navigation", "pet_supply_manipulation", "routine_and_quantity_tracking"],
    safetyGates: ["animal_welfare_and_supervision", "food_and_medication_boundary", "escape_and_entrapment_prevention"],
    preferenceTerms: /pet|dog|cat|animal|bowl|feed|water|walk/i
  },
  plants: {
    label: "Plant care",
    topics: ["plants"],
    requiredCapabilities: ["plant_and_pot_recognition", "soil_or_moisture_assessment", "controlled_watering", "plant_location_memory"],
    safetyGates: ["water_and_electrical_safety", "species_specific_care_confirmation", "spill_and_pot_stability"],
    preferenceTerms: /plant|water|pot|soil|leaf|garden|fertilis/i
  },
  recycling: {
    label: "Waste & recycling",
    topics: ["waste_and_recycling", "kitchen"],
    requiredCapabilities: ["material_classification", "waste_container_recognition", "object_manipulation", "local_sorting_rule_configuration"],
    safetyGates: ["sharp_and_hazardous_waste_detection", "local_recycling_rule_validation", "contamination_prevention"],
    preferenceTerms: /recycl|waste|rubbish|trash|bin|compost|packaging|glass|plastic|paper/i
  }
});

function cleanStrings(input, limit = 40) {
  return Array.isArray(input)
    ? [...new Set(input.filter((item) => typeof item === "string").map((item) => item.trim().toLowerCase()).filter(Boolean))].slice(0, limit)
    : [];
}

export function cleanPexiCapabilityManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  if (input.schema !== "app.mysecondself.pexi-capability-manifest" || input.schema_version !== "1.0.0") return null;
  const manufacturer = typeof input.manufacturer === "string" ? input.manufacturer.trim().slice(0, 120) : "";
  const model = typeof input.model === "string" ? input.model.trim().slice(0, 120) : "";
  const source = typeof input.source === "string" ? input.source.trim().slice(0, 500) : "";
  const completeness = input.completeness === "complete" ? "complete" : input.completeness === "partial" ? "partial" : "";
  const capabilities = cleanStrings(input.capabilities, 200);
  const declaredSafetyGates = cleanStrings(input.declared_safety_gates, 100);
  if (!manufacturer || !model || !source || !completeness || !capabilities.length) return null;
  return {
    schema: "app.mysecondself.pexi-capability-manifest",
    schema_version: "1.0.0",
    manufacturer,
    model,
    source,
    completeness,
    capabilities,
    declared_safety_gates: declaredSafetyGates
  };
}

function relevantPreferences(preferences, profile) {
  return (Array.isArray(preferences) ? preferences : []).filter((item) => {
    const value = String(item?.text || item?.statement || "");
    return value && profile.preferenceTerms.test(value + " " + String(item?.category || ""));
  }).map((item) => ({
    statement: String(item.text || item.statement).trim().slice(0, 420),
    status: String(item.status || item.epistemicStatus || "user_stated"),
    unresolved_fields: Array.isArray(item.unresolvedFields) ? item.unresolvedFields.slice(0, 12) : []
  }));
}

export function buildPexiCapabilityPlan({
  selectedFunctions = [],
  preferences = [],
  targetRobotType = "Humanoid robot",
  capabilityManifest = null
} = {}) {
  const selected = cleanStrings(selectedFunctions, 20);
  const manifest = cleanPexiCapabilityManifest(capabilityManifest);
  const declaredCapabilities = manifest ? manifest.capabilities : [];
  const manifestComplete = manifest?.completeness === "complete";
  const declaredSafety = manifest ? manifest.declared_safety_gates : [];
  const unresolvedPreferenceCount = (Array.isArray(preferences) ? preferences : [])
    .reduce((sum, item) => sum + (Array.isArray(item?.unresolvedFields) ? item.unresolvedFields.length : Array.isArray(item?.unresolved_fields) ? item.unresolved_fields.length : 0), 0);

  const tasks = selected.map((id) => {
    const profile = TASK_PROFILES[id];
    if (!profile) return {
      function_id: id,
      label: id,
      capability_status: "not_mapped",
      required_capabilities: [],
      supported_capabilities: [],
      missing_capabilities: [],
      unverified_capabilities: [],
      safety_gates: [],
      declared_safety_gates: [],
      unverified_safety_gates: [],
      undocumented_safety_gates: [],
      persona_preferences: []
    };

    const required = [...profile.requiredCapabilities];
    const supported = manifest ? required.filter((capability) => declaredCapabilities.includes(capability)) : [];
    const missing = manifestComplete ? required.filter((capability) => !declaredCapabilities.includes(capability)) : [];
    const unverified = manifest
      ? required.filter((capability) => !declaredCapabilities.includes(capability) && !manifestComplete)
      : required;
    const verifiedSafety = declaredSafety.filter((gate) => profile.safetyGates.includes(gate));
    const capabilityStatus = !manifest
      ? "unverified"
      : missing.length
        ? "missing_capabilities"
        : unverified.length
          ? "partially_verified"
          : "capability_match_safety_review_required";

    return {
      function_id: id,
      label: profile.label,
      capability_status: capabilityStatus,
      required_capabilities: required,
      supported_capabilities: supported,
      missing_capabilities: missing,
      unverified_capabilities: unverified,
      safety_gates: [...profile.safetyGates],
      declared_safety_gates: verifiedSafety,
      // A supplier declaration is evidence to review, not independent safety validation.
      unverified_safety_gates: [...profile.safetyGates],
      undocumented_safety_gates: profile.safetyGates.filter((gate) => !verifiedSafety.includes(gate)),
      persona_preferences: relevantPreferences(preferences, profile)
    };
  });

  const unknownTaskCount = tasks.filter((task) => task.capability_status === "not_mapped").length;
  const missingCount = tasks.filter((task) => task.capability_status === "missing_capabilities").length;
  const unresolvedTaskDetails = tasks.reduce((sum, task) => sum + task.persona_preferences.reduce((total, preference) => total + preference.unresolved_fields.length, 0), 0);
  let status = "awaiting_robot_specification";
  if (unresolvedPreferenceCount || unresolvedTaskDetails) status = "persona_details_open";
  else if (unknownTaskCount) status = "tasks_need_mapping";
  else if (manifest && missingCount) status = "required_capabilities_missing";
  else if (manifest && tasks.length && tasks.every((task) => task.capability_status === "capability_match_safety_review_required") &&
    tasks.every((task) => task.undocumented_safety_gates.length === 0)) status = "safety_validation_required";
  else if (manifest && tasks.length && tasks.every((task) => task.capability_status === "capability_match_safety_review_required")) status = "safety_gates_to_confirm";

  return {
    schema: "app.mysecondself.pexi-capability-plan",
    schema_version: "1.0.0",
    status,
    target_robot: {
      requested_type: String(targetRobotType || "Humanoid robot").slice(0, 80),
      manufacturer: String(manifest?.manufacturer || "").slice(0, 120) || null,
      model: String(manifest?.model || "").slice(0, 120) || null,
      capability_manifest_status: !manifest ? "not_supplied" : manifestComplete ? "declared_complete" : "partial",
      manifest_verification_status: manifest ? "not_independently_verified" : "not_supplied"
    },
    manifest_source: String(manifest?.source || "").slice(0, 500) || null,
    task_count: tasks.length,
    tasks,
    totals: {
      required_capabilities: tasks.reduce((sum, task) => sum + task.required_capabilities.length, 0),
      missing_capabilities: tasks.reduce((sum, task) => sum + task.missing_capabilities.length, 0),
      unverified_capabilities: tasks.reduce((sum, task) => sum + task.unverified_capabilities.length, 0),
      unverified_safety_gates: tasks.reduce((sum, task) => sum + task.unverified_safety_gates.length, 0),
      undocumented_safety_gates: tasks.reduce((sum, task) => sum + task.undocumented_safety_gates.length, 0),
      unresolved_preference_details: unresolvedPreferenceCount + unresolvedTaskDetails
    },
    execution_contract: {
      compatibility_claimed: false,
      physical_robot_connected: false,
      physical_actions_enabled: false,
      requires_target_robot_validation: true,
      requires_user_authorisation_before_physical_actions: true
    }
  };
}

export const PEXI_SUPPORTED_TASKS = Object.freeze(Object.keys(TASK_PROFILES));
