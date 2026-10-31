# PEXI robot capability manifest

SYNQ.ME can include an optional manufacturer/model capability declaration in the PEXI persona export. The imported file is stored locally in the current browser and included in the PEXI capability plan.

The manifest is a declaration source, not proof that a robot is compatible or safe to operate. PEXI deliberately leaves physical execution disabled and marks supplier declarations as not independently verified.

## JSON format

The file must be JSON and use this schema:

```json
{
  "schema": "app.mysecondself.pexi-capability-manifest",
  "schema_version": "1.0.0",
  "manufacturer": "Example Robotics",
  "model": "XR-1",
  "source": "https://manufacturer.example/robot-capabilities",
  "completeness": "partial",
  "capabilities": [
    "object_recognition",
    "object_pick_and_place",
    "mobile_navigation"
  ],
  "declared_safety_gates": [
    "glass_and_ceramic_handling"
  ]
}
```

Required fields are `manufacturer`, `model`, `source`, `completeness`, and a non-empty `capabilities` array. `completeness` is either `partial` or `complete`. A complete declaration means the source claims to enumerate the full capability set relevant to the manifest; it does not mean the claims have been verified.

Capability identifiers are case-normalised strings. PEXI compares these identifiers with task requirements defined in `src/pexi-readiness.js`. Declared safety gates are recorded as supplier statements only. They do not count as independent safety validation.

## Current task capability identifiers

| Task | Required capabilities |
|---|---|
| Dishwashing | `object_recognition`, `object_pick_and_place`, `dishwasher_interaction`, `controlled_force` |
| Vacuuming | `mobile_navigation`, `floor_surface_detection`, `cleaning_tool_interface`, `obstacle_avoidance` |
| Laundry | `textile_recognition`, `garment_manipulation`, `washer_dryer_interaction`, `garment_care_instruction_reading` |
| Folding | `textile_manipulation`, `garment_state_estimation`, `folding_manipulation`, `storage_location_mapping` |
| Tidying | `object_recognition`, `object_pick_and_place`, `spatial_memory`, `user_permission_enforcement` |
| Surface cleaning | `surface_material_recognition`, `cleaning_tool_manipulation`, `dispensing_control`, `force_control` |
| Meal preparation | `food_object_recognition`, `food_safe_manipulation`, `measuring_and_portioning`, `kitchen_tool_interaction` |
| Cooking | `food_object_recognition`, `cooktop_and_oven_interaction`, `temperature_monitoring`, `kitchen_tool_manipulation` |
| Groceries | `item_identification`, `inventory_tracking`, `expiry_and_label_reading`, `shelf_and_fridge_placement` |
| Pet care | `pet_detection`, `pet_safe_navigation`, `pet_supply_manipulation`, `routine_and_quantity_tracking` |
| Plant care | `plant_and_pot_recognition`, `soil_or_moisture_assessment`, `controlled_watering`, `plant_location_memory` |
| Recycling | `material_classification`, `waste_container_recognition`, `object_manipulation`, `local_sorting_rule_configuration` |

A task can be mapped to required capabilities without a target robot manifest. A manifest comparison can identify declared matches, declared gaps and capabilities that remain unverified. Safety assessment, evidence review, field testing and user authorisation remain separate requirements.
