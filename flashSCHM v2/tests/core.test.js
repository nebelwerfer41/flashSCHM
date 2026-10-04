import test from "node:test";
import assert from "node:assert/strict";
import { createState, createActor } from "../js/state.js";
import {
  parseTime,
  formatTime,
  addMinutes,
  subtractMinutes,
  roundToFiveMinutes,
} from "../js/utils/time.js";
import { generateSchedule } from "../js/scheduling/scheduler.js";
import {
  resolveRules,
  validateRuleConsistency,
  candidateOrders,
  generateTaskPermutations,
} from "../js/scheduling/rules.js";
import { isProfessionalAvailable } from "../js/scheduling/professionals.js";
import { detectConflicts, moveTask } from "../js/scheduling/conflicts.js";
import { parseRows, serializeRows } from "../js/io/xlsx.js";
const actor = (durations = [30, 30, 30], extra = {}) => {
  const a = createActor({ name: "Name - punctuation!", ...extra });
  a.tasks.forEach((t, i) => (t.duration = durations[i]));
  return a;
};
const rule = (type, extra = {}) => ({
  id: `${type}-${JSON.stringify(extra)}`,
  type,
  strength: "required",
  ...extra,
});
const input = (actors) => ({ ...createState(), actors });
test("time domain is integer minutes, explicit rounding, no midnight wrapping", () => {
  assert.equal(parseTime("06:30"), 390);
  assert.equal(formatTime(885), "14:45");
  assert.equal(addMinutes(390, 7), 397);
  assert.equal(subtractMinutes(0, 5), -5);
  assert.equal(roundToFiveMinutes(593), 595);
  for (const value of ["24:00", "10:60", "-1:00", "1:00", NaN])
    assert.throws(() => parseTime(value));
  assert.throws(() => formatTime(-5));
  assert.equal(formatTime(1440), "24:00");
});
test("single task is READY anchored; input stays unchanged and result deterministic", () => {
  const s = input([actor([30, 0, 0])]),
    original = structuredClone(s),
    a = generateSchedule(s);
  assert.equal(a.success, true);
  assert.equal(a.actors[0].schedule[0].start, 570);
  assert.equal(a.actors[0].arrival, 570);
  assert.deepEqual(s, original);
  assert.deepEqual(generateSchedule(s), a);
});
test("default order preserves legacy descending priorities and sequential timing", () => {
  const r = generateSchedule(input([actor()]));
  assert.deepEqual(
    r.actors[0].schedule.map((t) => t.type),
    ["costumi", "capelli", "trucco"],
  );
  assert.deepEqual(
    r.actors[0].schedule.map((t) => t.start),
    [510, 540, 570],
  );
  assert.deepEqual(detectConflicts(r.actors), []);
});
test("shared professionals shift earlier; corrected arrival equals actual earliest task", () => {
  const s = input([actor([30, 0, 0]), actor([30, 0, 0])]);
  s.professionals.trucco = s.professionals.trucco.slice(0, 1);
  const r = generateSchedule(s);
  assert.equal(r.success, true);
  assert.deepEqual(
    r.actors.map((a) => a.arrival),
    [570, 540],
  );
  assert.deepEqual(detectConflicts(r.actors), []);
});
test("priority then READY then input order: IDs never determine decisions", () => {
  const a = actor([30, 0, 0], { priority: 2 }),
    b = actor([30, 0, 0], { priority: 1 });
  const s = input([a, b]);
  s.professionals.trucco = s.professionals.trucco.slice(0, 1);
  assert.equal(generateSchedule(s).actors[0].id, b.id);
});
test("availability is pure; touching reservations do not overlap", () => {
  const p = { id: "p" },
    slots = { p: [{ start: 540, end: 570 }] },
    copy = structuredClone(slots);
  assert.equal(isProfessionalAvailable(p, 570, 600, slots), true);
  assert.equal(isProfessionalAvailable(p, 560, 590, slots), false);
  assert.deepEqual(slots, copy);
});
test("preferred professional falls back; required professional shifts earlier", () => {
  const a = actor([30, 0, 0]),
    b = actor([30, 0, 0]),
    s = input([a, b]),
    p = s.professionals.trucco[0];
  b.rules.add = [
    rule("professional", {
      department: "trucco",
      professionalId: p.id,
      strength: "preferred",
    }),
  ];
  let r = generateSchedule(s);
  assert.equal(r.actors[1].arrival, 570);
  assert.equal(
    r.actors[1].schedule[0].professionalId,
    s.professionals.trucco[1].id,
  );
  b.rules.add[0].strength = "required";
  r = generateSchedule(s);
  assert.deepEqual(r.actors.map((item) => item.arrival), [570, 570]);
  assert.equal(r.actors[1].schedule[0].professionalId, p.id);
  assert.equal(
    r.actors[0].schedule[0].professionalId,
    s.professionals.trucco[1].id,
  );
});
test("missing required professional fails structurally, including zero-capacity department", () => {
  const a = actor([0, 0, 30]);
  a.rules.add = [
    rule("professional", { department: "costumi", professionalId: "missing" }),
  ];
  const r = generateSchedule(input([a]));
  assert.equal(r.success, false);
  assert.equal(r.diagnostics[0].type, "required-professional-unavailable");
  assert.deepEqual(r.professionalSchedules, {});
});
test("same-day failure near midnight cannot wrap end past READY", () => {
  const r = generateSchedule(input([actor([30, 0, 0], { ready: 10 })]));
  assert.equal(r.success, false);
  assert.equal(r.diagnostics[0].type, "cannot-finish-before-ready");
});
test("empty actors and actors with no required tasks succeed", () => {
  assert.equal(generateSchedule(input([])).success, true);
  const r = generateSchedule(input([actor([0, 0, 0])]));
  assert.equal(r.success, true);
  assert.equal(r.actors[0].arrival, 600);
});
test("additive partial rules derive complete order without user specifying it", () => {
  const global = [rule("before", { first: "trucco", second: "capelli" })],
    own = { add: [rule("last", { department: "costumi" })] };
  const rules = resolveRules(global, own);
  const orders = candidateOrders(
    ["trucco", "capelli", "costumi"].map((type) => ({ type })),
    rules,
  );
  assert.equal(orders.length, 1);
  assert.deepEqual(
    orders[0].map((t) => t.type),
    ["trucco", "capelli", "costumi"],
  );
});
test("one before relation leaves all three compatible permutations; missing tasks irrelevant", () => {
  const r = rule("before", { first: "trucco", second: "capelli" });
  assert.equal(
    candidateOrders(
      ["trucco", "capelli", "costumi"].map((type) => ({ type })),
      resolveRules([r]),
    ).length,
    3,
  );
  const rules = resolveRules([r, rule("last", { department: "trucco" })], {}, [
    "capelli",
    "costumi",
  ]);
  assert.equal(
    candidateOrders(
      ["capelli", "costumi"].map((type) => ({ type })),
      rules,
    ).length,
    2,
  );
});
test("explicit disable and replacement preserve unrelated inherited rules", () => {
  const a = rule("before", { first: "trucco", second: "capelli" }),
    b = rule("last", { department: "costumi" });
  let r = resolveRules([a, b], { disabled: [a.id], add: [] });
  assert.deepEqual(
    r.map((x) => x.id),
    [b.id],
  );
  r = resolveRules([a, b], { add: [{ ...a, strength: "preferred" }] });
  assert.equal(r.length, 2);
  assert.equal(r.find((x) => x.id === a.id).strength, "preferred");
});
test("required cycles and competing first rules diagnosed before search", () => {
  for (const rules of [
    [
      rule("before", { first: "trucco", second: "capelli" }),
      rule("after", { first: "trucco", second: "capelli" }),
    ],
    [
      rule("first", { department: "trucco" }),
      rule("first", { department: "capelli" }),
    ],
  ]) {
    const v = validateRuleConsistency(resolveRules(rules), [
      "trucco",
      "capelli",
      "costumi",
    ]);
    assert.equal(v.valid, false);
    assert.equal(v.diagnostics[0].type, "contradictory-order-constraints");
  }
});
test("complete required order and soft order share candidate pipeline", () => {
  const tasks = ["trucco", "capelli", "costumi"].map((type) => ({ type })),
    r = rule("order", { order: ["trucco", "capelli", "costumi"] });
  assert.equal(candidateOrders(tasks, resolveRules([r])).length, 1);
  r.strength = "preferred";
  const orders = candidateOrders(tasks, resolveRules([r]));
  assert.equal(orders.length, 6);
  assert.deepEqual(orders[0], tasks);
  assert.equal(generateTaskPermutations([]).length, 1);
});
test("manual editing uses stable identity, recalculates arrival and detects both conflicts", () => {
  const s = input([actor([30, 0, 0]), actor([30, 0, 0])]);
  s.professionals.trucco = s.professionals.trucco.slice(0, 1);
  s.actors = generateSchedule(s).actors;
  const [a, b] = s.actors,
    t = b.schedule[0];
  a.name = "Renamed - actor";
  assert.equal(
    moveTask(s, {
      actorId: b.id,
      taskId: t.id,
      start: 570,
      end: 600,
      professionalId: t.professionalId,
    }).valid,
    true,
  );
  assert.equal(b.arrival, 570);
  assert.equal(detectConflicts(s.actors)[0].type, "professional-overlap");
  const other = {
    ...a.schedule[0],
    id: "different-task",
    type: "capelli",
    professionalId: null,
  };
  a.schedule.push(other);
  assert.ok(detectConflicts(s.actors).some((c) => c.type === "actor-overlap"));
  assert.equal(
    moveTask(s, {
      actorId: b.id,
      taskId: t.id,
      start: 570,
      end: 600,
      professionalId: s.professionals.capelli[0].id,
    }).valid,
    false,
  );
});
test("manual hard-rule and READY violations stay visible; resolved conflicts clear", () => {
  const a = actor([30, 30, 0]),
    s = input([a]);
  s.rules = [rule("before", { first: "trucco", second: "capelli" })];
  s.actors = generateSchedule(s).actors;
  const t = s.actors[0].schedule.find((t) => t.type === "trucco");
  moveTask(s, {
    actorId: a.id,
    taskId: t.id,
    start: 610,
    end: 640,
    professionalId: t.professionalId,
  });
  assert.ok(
    detectConflicts(s.actors, s.rules).some((c) => c.type === "after-ready"),
  );
  assert.ok(
    detectConflicts(s.actors, s.rules).some(
      (c) => c.type === "required-order-violated",
    ),
  );
  moveTask(s, {
    actorId: a.id,
    taskId: t.id,
    start: 540,
    end: 570,
    professionalId: t.professionalId,
  });
  assert.deepEqual(detectConflicts(s.actors, s.rules), []);
});
test("legacy XLS indices including zero migrate to required rules and stable IDs", () => {
  const s = parseRows({
    Actors: [
      {
        Nome: "Same - name",
        OrarioPronti: "10:00",
        DurataTrucco: 30,
        ProfessionistaTrucco: 0,
      },
      {
        Nome: "Same - name",
        OrarioPronti: 0.5,
        DurataTrucco: 30,
        ProfessionistaTrucco: 1,
      },
    ],
  });
  assert.notEqual(s.actors[0].id, s.actors[1].id);
  assert.equal(s.actors[0].rules.add[0].strength, "required");
  assert.equal(
    s.actors[0].rules.add[0].professionalId,
    s.professionals.trucco[0].id,
  );
  assert.equal(s.actors[1].ready, 720);
  assert.deepEqual(parseRows(serializeRows(s)), s);
});
test("versioned XLS rows retain schedules, IDs, overrides and partial rules", () => {
  const s = input([actor()]);
  s.actors[0].rules.disabled = ["default-order"];
  s.actors[0].rules.add = [rule("last", { department: "costumi" })];
  s.actors = generateSchedule(s).actors;
  assert.deepEqual(parseRows(serializeRows(s)), s);
  assert.throws(() => parseRows({ FlashSCHM: [{ Version: 9, Data: "{}" }] }));
});
test("global READY persists in projects and supplies blank new XLSX actor rows", () => {
  const state = input([actor([15, 0, 0], { name: "Existing", ready: 610 })]);
  state.settings.defaultReady = 555;
  const rows = serializeRows(state);
  rows.Actors.push({ Nome: "New", OrarioPronti: "", DurataTrucco: 20 });
  const imported = parseRows(rows);
  assert.equal(imported.settings.defaultReady, 555);
  assert.deepEqual(imported.actors.map((a) => a.ready), [610, 555]);
  assert.equal(imported.actors[1].tasks[0].duration, 20);
  assert.deepEqual(parseRows(serializeRows(imported)), imported);
});
test("older project metadata receives a valid global READY default", () => {
  const state = input([actor([15, 0, 0], { name: "Existing" })]);
  const rows = serializeRows(state);
  const old = JSON.parse(rows.FlashSCHM[0].Data);
  delete old.settings.defaultReady;
  rows.FlashSCHM[0].Data = JSON.stringify(old);
  assert.equal(parseRows(rows).settings.defaultReady, 600);
  state.settings.defaultReady = 1440;
  assert.throws(() => serializeRows(state), /invalid-project/);
});
test("editable actor rows update versioned projects while preserving advanced rules", () => {
  const s = input([
    actor([20, 15, 0], { name: "Mario" }),
    actor([10, 0, 0], { name: "Luigi" }),
  ]);
  s.actors[0].rules.add = [rule("last", { department: "costumi" })];
  s.actors = generateSchedule(s).actors;
  const originalId = s.actors[0].id;
  const originalTaskIds = s.actors[0].tasks.map((task) => task.id);
  const rows = serializeRows(s);
  rows.Actors[0].Nome = "Mario Rossi";
  rows.Actors[0].OrarioPronti = "11:30";
  rows.Actors[0].DurataTrucco = 35;
  rows.Actors[0].PrioritaAttore = 2;
  rows.Actors.pop();
  rows.Actors.push({ Nome: "Peach", OrarioPronti: "12:00", DurataCapelli: 25 });
  const imported = parseRows(rows);
  assert.deepEqual(imported.actors.map((a) => a.name), ["Mario Rossi", "Peach"]);
  assert.equal(imported.actors[0].id, originalId);
  assert.deepEqual(imported.actors[0].tasks.map((task) => task.id), originalTaskIds);
  assert.deepEqual(imported.actors[0].rules.add, s.actors[0].rules.add);
  assert.equal(imported.actors[0].ready, 690);
  assert.equal(imported.actors[0].tasks[0].duration, 35);
  assert.equal(imported.actors[1].tasks[1].duration, 25);
  assert.ok(imported.actors.every((a) => a.schedule.length === 0));
});
test("version 2 actor edits use row position; version 3 rejects ambiguous IDs", () => {
  const s = input([actor([20, 0, 0], { name: "Original" })]);
  const rows = serializeRows(s);
  rows.FlashSCHM.forEach((row) => (row.Version = 2));
  delete rows.Actors[0].ID;
  rows.Actors[0].Nome = "Edited";
  rows.Actors[0].OrarioPronti = "11:00";
  assert.equal(parseRows(rows).actors[0].name, "Edited");
  assert.equal(parseRows(rows).actors[0].ready, 660);
  rows.Actors.push({ Nome: "Added", OrarioPronti: "12:00" });
  assert.throws(() => parseRows(rows), /riesporta il progetto/);
  rows.Actors.pop();
  const reordered = serializeRows(input([
    actor([20, 0, 0], { name: "Mario" }),
    actor([15, 0, 0], { name: "Luigi" }),
  ]));
  reordered.FlashSCHM.forEach((row) => (row.Version = 2));
  reordered.Actors.reverse();
  assert.throws(() => parseRows(reordered), /riordinare gli attori/);
  rows.FlashSCHM.forEach((row) => (row.Version = 3));
  rows.Actors[0].ID = s.actors[0].id;
  rows.Actors.push({ ...rows.Actors[0] });
  assert.throws(() => parseRows(rows), /ID attore sconosciuto o duplicato/);
  rows.Actors.pop();
  rows.Actors[0].ID = "unknown";
  assert.throws(() => parseRows(rows), /ID attore sconosciuto o duplicato/);
  rows.Actors[0].ID = s.actors[0].id;
  rows.Actors[0].OrarioPronti = "25:00";
  assert.throws(() => parseRows(rows), /OrarioPronti non valido/);
  rows.Actors[0].OrarioPronti = "10:00";
  rows.Actors[0].DurataTrucco = -1;
  assert.throws(() => parseRows(rows), /DurataTrucco non valido/);
  assert.throws(
    () => parseRows({ FlashSCHM: rows.FlashSCHM }),
    /missing-actors-sheet/,
  );
});
test("a name-only spreadsheet edit keeps the saved manual schedule", () => {
  const s = input([actor([20, 0, 0], { name: "Old name" })]);
  s.actors = generateSchedule(s).actors;
  const rows = serializeRows(s);
  rows.Actors[0].Nome = "New name";
  const imported = parseRows(rows);
  assert.equal(imported.actors[0].name, "New name");
  assert.deepEqual(imported.actors[0].schedule, s.actors[0].schedule);
});
test("Mario and Luigi share Costume and alternate Makeup/Hair without an earlier arrival", () => {
  const s = input([
    actor([15, 15, 15], { name: "Mario" }),
    actor([15, 15, 15], { name: "Luigi" }),
  ]);
  s.professionals.trucco = s.professionals.trucco.slice(0, 1);
  s.professionals.capelli = s.professionals.capelli.slice(0, 1);
  s.rules = [
    rule("order", {
      order: ["trucco", "capelli", "costumi"],
      strength: "preferred",
    }),
  ];
  const r = generateSchedule(s);
  assert.equal(r.success, true);
  assert.deepEqual(
    r.actors.map((a) => a.arrival),
    [555, 555],
  );
  assert.deepEqual(
    r.actors.map((a) => a.schedule.find((t) => t.type === "costumi").start),
    [585, 585],
  );
  assert.deepEqual(
    r.actors[1].schedule.map((t) => t.type),
    ["capelli", "trucco", "costumi"],
  );
  assert.deepEqual(detectConflicts(r.actors, s.rules), []);
});
test("global reassignment keeps the first activity at 06:45 when Marta requires Costume last", () => {
  const s = input([
    actor([15, 15, 15], { name: "Mario", ready: 480 }),
    actor([15, 15, 15], { name: "Luigi", ready: 480 }),
    actor([30, 30, 15], { name: "Marta", ready: 480 }),
    actor([30, 15, 20], { name: "Marghe", ready: 480 }),
  ]);
  s.rules = [rule("last", { department: "costumi", strength: "preferred" })];
  s.actors[2].rules.disabled = [s.rules[0].id];
  s.actors[2].rules.add = [rule("last", { department: "costumi" })];
  const original = structuredClone(s);
  const r = generateSchedule(s);
  assert.equal(r.success, true);
  assert.equal(Math.min(...r.actors.map((item) => item.arrival)), 405);
  assert.equal(r.actors.find((item) => item.name === "Marta").arrival, 405);
  assert.equal(
    r.actors.find((item) => item.name === "Marta").schedule.at(-1).type,
    "costumi",
  );
  for (const item of r.actors) {
    const duration = item.tasks.reduce((sum, task) => sum + task.duration, 0);
    assert.equal(item.ready - item.arrival - duration, 0);
  }
  assert.deepEqual(detectConflicts(r.actors, s.rules), []);
  assert.deepEqual(s, original);
  assert.deepEqual(generateSchedule(s), r);
});
test("the same opening still permits a better professional assignment", () => {
  const fixed = actor([0, 0, 75], { name: "Fixed", ready: 480 });
  const flexible = actor([30, 0, 0], { name: "Flexible", ready: 480 });
  const required = actor([30, 0, 0], { name: "Required", ready: 480 });
  const s = input([fixed, flexible, required]);
  required.rules.add = [
    rule("professional", {
      department: "trucco",
      professionalId: s.professionals.trucco[0].id,
    }),
  ];
  const r = generateSchedule(s);
  assert.equal(Math.min(...r.actors.map((item) => item.arrival)), 405);
  assert.deepEqual(r.actors.map((item) => item.arrival), [405, 450, 450]);
  assert.equal(
    r.actors[1].schedule[0].professionalId,
    s.professionals.trucco[1].id,
  );
  assert.deepEqual(detectConflicts(r.actors, s.rules), []);
});
test("required Costume last alone allows the Mario/Luigi interchange", () => {
  const s = input([actor([15, 15, 15]), actor([15, 15, 15])]);
  for (const type of ["trucco", "capelli"])
    s.professionals[type] = s.professionals[type].slice(0, 1);
  s.rules = [rule("last", { department: "costumi" })];
  const r = generateSchedule(s);
  assert.deepEqual(
    r.actors.map((a) => a.arrival),
    [555, 555],
  );
  assert.deepEqual(detectConflicts(r.actors, s.rules), []);
});
test("required complete order still prevents interchange, limited Costume capacity still serializes", () => {
  const s = input([actor([15, 15, 15]), actor([15, 15, 15])]);
  for (const type of ["trucco", "capelli"])
    s.professionals[type] = s.professionals[type].slice(0, 1);
  s.rules = [rule("order", { order: ["trucco", "capelli", "costumi"] })];
  let r = generateSchedule(s);
  assert.deepEqual(
    r.actors.map((a) => a.arrival),
    [555, 540],
  );
  s.rules = [rule("last", { department: "costumi" })];
  s.professionals.costumi = [{ id: "costume-pro", name: "Costumer" }];
  r = generateSchedule(s);
  assert.deepEqual(detectConflicts(r.actors, s.rules), []);
  assert.notEqual(
    r.actors[0].schedule.find((t) => t.type === "costumi").start,
    r.actors[1].schedule.find((t) => t.type === "costumi").start,
  );
});
test("large versioned exports split metadata below Excel cell limits", () => {
  const s = input(
    Array.from({ length: 80 }, (_, i) =>
      actor([15, 15, 15], { name: `Actor ${i}` }),
    ),
  );
  const rows = serializeRows(s);
  assert.ok(rows.FlashSCHM.length > 1);
  assert.ok(rows.FlashSCHM.every((row) => row.Data.length <= 30000));
  assert.deepEqual(parseRows(rows), s);
});
test("global professional requirement can be disabled for one actor; irrelevant departments ignored", () => {
  const a = actor([0, 15, 0]),
    s = input([a]);
  s.rules = [
    rule("professional", { department: "trucco", professionalId: "missing" }),
  ];
  assert.equal(generateSchedule(s).success, true);
  a.tasks[0].duration = 15;
  assert.equal(generateSchedule(s).success, false);
  a.rules.disabled = [s.rules[0].id];
  assert.equal(generateSchedule(s).success, true);
});
test("nonstandard legacy department weights keep exactly the original candidate ranking", () => {
  const s = parseRows({
    Actors: [],
    Depts: [
      { Reparto: "trucco", NumeroProfessionisti: 1, Priorita: 1 },
      { Reparto: "capelli", NumeroProfessionisti: 1, Priorita: 4 },
      { Reparto: "costumi", NumeroProfessionisti: 0, Priorita: 9 },
    ],
  });
  const tasks = ["trucco", "capelli", "costumi"].map((type) => ({ type }));
  const expected = generateTaskPermutations(tasks).sort((a, b) => {
    const score = (order) =>
      order.reduce(
        (sum, t, i) =>
          sum + { trucco: 1, capelli: 4, costumi: 9 }[t.type] * (i + 1),
        0,
      );
    return score(a) - score(b);
  });
  assert.deepEqual(candidateOrders(tasks, resolveRules(s.rules)), expected);
});
