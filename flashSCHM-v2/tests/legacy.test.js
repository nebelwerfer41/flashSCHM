import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

export function legacy() {
  const context = vm.createContext({
    console: { log() {}, warn() {}, error() {} },
  });
  const timeline = readFileSync(
    new URL("./legacy/timeline.js", import.meta.url),
    "utf8",
  );
  vm.runInContext(timeline.slice(timeline.indexOf("// Adds minutes")), context);
  vm.runInContext(
    readFileSync(new URL("./legacy/scheduling.js", import.meta.url), "utf8"),
    context,
  );
  vm.runInContext(
    `var professionalSettings = {trucco:{count:1},capelli:{count:1},costumi:{count:0}};
    var professionals; var departmentPriority = {trucco:1,capelli:2,costumi:3}; initializeProfessionals();`,
    context,
  );
  return context;
}
const actor = (tasks, extra = {}) => ({
  name: "Actor",
  readyTime: "10:00",
  arrivalTime: "09:00",
  tasks,
  schedule: [],
  scheduleInfo: {},
  makeupProfessional: null,
  hairProfessional: null,
  ...extra,
});
test("legacy time arithmetic: subtraction rounds, addition does not; midnight wraps", () => {
  const l = legacy();
  assert.equal(l.subtractMinutes("10:00", 7), "09:55");
  assert.equal(l.addMinutes("10:00", 7), "10:07");
  assert.equal(l.subtractMinutes("00:00", 5), "23:55");
});
test("legacy permutations favor descending priorities and generate all six", () => {
  const l = legacy(),
    p = l.generateTaskPermutations(
      ["trucco", "capelli", "costumi"].map((type) => ({ type })),
      l.departmentPriority,
    );
  assert.equal(p.length, 6);
  assert.equal(p[0].map((t) => t.type).join(","), "costumi,capelli,trucco");
});
test("legacy single task searches backwards when a professional is busy", () => {
  const l = legacy();
  l.professionals.trucco[0].push({ startTime: "09:30", endTime: "10:00" });
  const a = actor([{ type: "trucco", duration: 30 }], { arrivalTime: "09:30" });
  assert.equal(l.trySchedulingActor(a), true);
  assert.equal(a.schedule[0].startTime, "09:00");
  // Confirmed bug: the originally estimated arrival is not updated after searching backwards.
  assert.equal(a.arrivalTime, "09:30");
});
test("legacy sequential actor tasks do not overlap", () => {
  const l = legacy(),
    a = actor([
      { type: "trucco", duration: 30 },
      { type: "capelli", duration: 30 },
    ]);
  assert.equal(l.trySchedulingActor(a), true);
  assert.equal(a.schedule[0].type, "capelli");
  assert.equal(a.schedule[1].startTime, "09:30");
});
test("legacy professional preference is required and availability mutates task", () => {
  const l = legacy();
  l.professionals.trucco.push([]);
  l.professionals.trucco[0].push({ startTime: "09:00", endTime: "10:00" });
  const t = { type: "trucco", duration: 30 };
  assert.equal(
    l.isProfessionalAvailable(t, "09:00", "09:30", l.professionals, 0),
    false,
  );
  assert.equal(
    l.isProfessionalAvailable(t, "09:00", "09:30", l.professionals, null),
    true,
  );
  assert.equal(t.professionalIndex, 1);
});
test("legacy failure when no same-day slot exists", () => {
  const l = legacy();
  l.professionals.trucco[0].push({ startTime: "00:00", endTime: "10:00" });
  assert.equal(
    l.findEarliestStartTimeForTask(
      { type: "trucco", duration: 30 },
      "09:30",
      "10:00",
      l.professionals,
    ),
    null,
  );
});
test("legacy zero professionals means unconstrained capacity", () => {
  const l = legacy(),
    a = actor([{ type: "costumi", duration: 60 }]);
  assert.equal(l.trySchedulingActor(a), true);
  assert.equal(a.schedule[0].startTime, "09:00");
});
test("legacy initialization calls timeline before datasets are initialized", () => {
  const context = legacy();
  context.document = {
    querySelectorAll: () => [],
    getElementById: (id) => ({
      value: id.endsWith("-count")
        ? "1"
        : id.endsWith("-priority")
          ? {
              "trucco-priority": "1",
              "capelli-priority": "2",
              "costumi-priority": "3",
            }[id]
          : "Name",
    }),
  };
  context.alert = () => {};
  const script = readFileSync(
    new URL("./legacy/script.js", import.meta.url),
    "utf8",
  );
  const timeline = readFileSync(
    new URL("./legacy/timeline.js", import.meta.url),
    "utf8",
  );
  // Use a fresh context so script's lexical declarations do not collide with the harness.
  const fresh = vm.createContext({
    document: context.document,
    console: context.console,
    alert: context.alert,
  });
  const scheduling = readFileSync(
    new URL("./legacy/scheduling.js", import.meta.url),
    "utf8",
  );
  assert.throws(
    () => vm.runInContext(scheduling + "\n" + script + "\n" + timeline, fresh),
    /undefined.*clear|clear.*undefined/,
  );
});
test("legacy wrapped task end can incorrectly pass the READY check", () => {
  const l = legacy();
  assert.equal(
    l.findEarliestStartTimeForTask(
      { type: "costumi", duration: 20 },
      "23:50",
      "23:55",
      l.professionals,
    ),
    "23:50",
  );
  assert.equal(l.addMinutes("23:50", 20), "00:10");
});
