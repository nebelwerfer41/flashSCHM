import test from "node:test";
import assert from "node:assert/strict";
import { createState, createActor } from "../js/state.js";
import { generateSchedule } from "../js/scheduling/scheduler.js";
import { moveTask } from "../js/scheduling/conflicts.js";
import { saveSchedule, openSchedule, deleteSchedule } from "../js/versions.js";
import { parseRows, serializeRows } from "../js/io/xlsx.js";

test("saved versions isolate every part of the plan and reopen as editable copies", () => {
  const state = createState();
  const actor = createActor({ name: "Mario" });
  actor.tasks[0].duration = 20;
  state.actors.push(actor);
  const generated = generateSchedule(state).actors[0];
  actor.schedule = generated.schedule;
  actor.arrival = generated.arrival;
  const version = saveSchedule(state, "  Prima prova  ", "2026-10-03T10:00:00.000Z");
  assert.equal(version.name, "Prima prova");
  assert.equal(version.plan.savedSchedules, undefined);
  const original = structuredClone(version.plan);
  moveTask(state, {
    actorId: actor.id,
    taskId: actor.schedule[0].id,
    start: 560,
    end: 580,
    professionalId: actor.schedule[0].professionalId,
  });
  actor.name = "Changed";
  actor.ready = 700;
  actor.tasks[0].duration = 35;
  state.professionals.trucco[0].name = "Changed pro";
  state.rules[0].order.reverse();
  assert.deepEqual(version.plan, original);
  const reopened = openSchedule(state, version.id);
  assert.deepEqual(reopened.actors, original.actors);
  reopened.actors[0].name = "Editing reopened copy";
  reopened.actors[0].schedule[0].start += 5;
  assert.deepEqual(version.plan, original);
  assert.equal(reopened.savedSchedules[0].id, version.id);
  assert.deepEqual(parseRows(serializeRows(reopened)), reopened);
  deleteSchedule(reopened, version.id);
  assert.equal(reopened.savedSchedules.length, 0);
  assert.throws(() => openSchedule(reopened, version.id), /non trovata/);
});

test("Programmazioni contains one readable row per saved activity and import keeps versions", () => {
  const state = createState();
  const actor = createActor({ name: "Luigi" });
  actor.tasks.find((task) => task.type === "trucco").duration = 15;
  actor.tasks.find((task) => task.type === "capelli").duration = 15;
  state.actors.push(actor);
  const generated = generateSchedule(state).actors[0];
  actor.schedule = generated.schedule;
  actor.arrival = generated.arrival;
  const version = saveSchedule(state, "Piano A", "2026-10-03T10:00:00.000Z");
  const rows = serializeRows(state);
  assert.equal(rows.FlashSCHM[0].Version, 5);
  assert.equal(rows.Programmazioni.length, 2);
  assert.deepEqual(rows.Programmazioni.map((row) => row.Reparto), actor.schedule.map((task) => task.type));
  assert.equal(rows.Programmazioni[0].IDVersione, version.id);
  assert.equal(rows.Programmazioni[0].Attore, "Luigi");
  assert.equal(rows.Programmazioni[0].READY, "10:00");
  assert.equal(rows.Programmazioni[0].Professionista, "Ciro");
  rows.Programmazioni[0].Attore = "Spreadsheet display edit";
  assert.deepEqual(parseRows(rows), state);
  const old = serializeRows(createState());
  old.FlashSCHM[0].Version = 3;
  const metadata = JSON.parse(old.FlashSCHM[0].Data);
  delete metadata.savedSchedules;
  old.FlashSCHM[0].Data = JSON.stringify(metadata);
  assert.deepEqual(parseRows(old).savedSchedules, []);
});
