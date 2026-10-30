import test from "node:test";
import assert from "node:assert/strict";
import {
  ROOM_JOURNEY_ROOMS,
  addMonthsAnchored,
  buildRoomProgressSnapshot,
  deriveCompletedRoomTasks,
  getRoomJourneySchedule,
  getRoomTaskStates,
  buildRoomJourneyConversationContext
} from "../src/room-journey.js";

test("each account unlocks rooms from its own start date", () => {
  const first = getRoomJourneySchedule("2026-10-15T12:00:00.000Z", "2026-11-14T12:00:00.000Z");
  const second = getRoomJourneySchedule("2026-11-01T12:00:00.000Z", "2026-11-14T12:00:00.000Z");
  assert.equal(first.unlockedCount, 1);
  assert.deepEqual(first.unlockedRooms.map((room) => room.id), ["kitchen"]);
  assert.equal(second.unlockedCount, 1);
  assert.deepEqual(second.unlockedRooms.map((room) => room.id), ["kitchen"]);
});

test("a new room unlocks on the user's monthly anniversary", () => {
  const before = getRoomJourneySchedule("2026-10-15T12:00:00.000Z", "2026-11-14T11:59:59.999Z");
  const onDate = getRoomJourneySchedule("2026-10-15T12:00:00.000Z", "2026-11-15T12:00:00.000Z");
  assert.equal(before.unlockedCount, 1);
  assert.equal(onDate.unlockedCount, 2);
  assert.equal(onDate.unlockedRooms[1].id, "living_room");
  assert.equal(onDate.nextUnlockAt.toISOString(), "2026-12-15T12:00:00.000Z");
});

test("month-end anniversaries clamp to the last day of shorter months", () => {
  assert.equal(addMonthsAnchored("2026-01-31T09:00:00.000Z", 1).toISOString(), "2026-02-28T09:00:00.000Z");
  assert.equal(addMonthsAnchored("2026-01-31T09:00:00.000Z", 2).toISOString(), "2026-03-31T09:00:00.000Z");
});

test("only saved user-stated or confirmed preferences complete room tasks", () => {
  const kitchen = ROOM_JOURNEY_ROOMS.find((room) => room.id === "kitchen");
  const evidence = [
    { text: "I prefer the dishwasher loaded with glasses on the top rack.", status: "user_stated" },
    { text: "I like my kitchen worktop wiped after breakfast.", status: "user_confirmed" },
    { text: "The cleaning spray might be suitable.", status: "inferred_pending_confirmation" },
    { text: "I use a dish soap I prefer.", status: "assistant_suggested" }
  ];
  assert.deepEqual(deriveCompletedRoomTasks(kitchen, evidence), ["dishwashing", "surfaces"]);
});

test("room progress can be derived across the released curriculum", () => {
  const snapshot = buildRoomProgressSnapshot(ROOM_JOURNEY_ROOMS, [
    { text: "I prefer the washing machine on a cool cycle.", status: "user_stated" },
    { text: "I like my outdoor cushions stored away before rain.", status: "user_confirmed" }
  ]);
  assert.deepEqual(snapshot.laundry_utility.completed_task_ids, ["washing"]);
  assert.deepEqual(snapshot.balcony_patio.completed_task_ids, ["weather"]);
  assert.equal(Object.keys(snapshot).length, 12);
});


test("room tasks distinguish the current task, completed tasks and pending tasks", () => {
  const kitchen = ROOM_JOURNEY_ROOMS.find((room) => room.id === "kitchen");
  const states = getRoomTaskStates(kitchen, ["dishwashing"], "surfaces");
  assert.deepEqual(states.map((task) => [task.id, task.status]), [
    ["dishwashing", "completed"],
    ["surfaces", "current"],
    ["products", "pending"],
    ["food-prep", "pending"],
    ["boundaries", "pending"]
  ]);
});

test("a completed task cannot remain marked as the current task", () => {
  const kitchen = ROOM_JOURNEY_ROOMS.find((room) => room.id === "kitchen");
  const states = getRoomTaskStates(kitchen, ["dishwashing"], "dishwashing");
  assert.equal(states.find((task) => task.id === "dishwashing").status, "completed");
  assert.equal(states.some((task) => task.status === "current"), false);
});


test("conversation context carries the selected task and next pending task for the active room", () => {
  const context = buildRoomJourneyConversationContext({
    activeRoomId: "kitchen",
    activeTaskId: "surfaces",
    completedTaskIds: ["dishwashing"],
    unlockedRoomCount: 1
  });
  assert.equal(context.activeRoomName, "Kitchen");
  assert.equal(context.activeTaskId, "surfaces");
  assert.equal(context.activeTaskTitle, "Worktops and surfaces");
  assert.equal(context.nextPendingTaskId, "surfaces");
  assert.equal(context.nextPendingTaskTitle, "Worktops and surfaces");
  assert.equal(context.tasks.find((task) => task.id === "surfaces").current, true);
  assert.equal(context.tasks.find((task) => task.id === "dishwashing").completed, true);
});

test("conversation context does not select a completed task as current", () => {
  const context = buildRoomJourneyConversationContext({
    activeRoomId: "kitchen",
    activeTaskId: "dishwashing",
    completedTaskIds: ["dishwashing"],
    unlockedRoomCount: 2
  });
  assert.equal(context.activeTaskId, null);
  assert.equal(context.activeTaskTitle, null);
  assert.equal(context.nextPendingTaskId, "surfaces");
  assert.equal(context.tasks.some((task) => task.current), false);
});
