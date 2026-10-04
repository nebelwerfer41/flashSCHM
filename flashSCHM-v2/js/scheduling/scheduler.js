import { DEPARTMENTS } from "../state.js";
import { roundToFiveMinutes, overlaps, arrivalTime } from "../utils/time.js";
import {
  resolveRules,
  validateRuleConsistency,
  candidateOrders,
  validateCandidate,
} from "./rules.js";
import {
  findAvailableProfessionals,
  selectProfessional,
  reserveProfessional,
} from "./professionals.js";
import { rebalanceOpening } from "./rebalance.js";

function scheduleCandidate(
  actor,
  order,
  arrival,
  professionals,
  reservations,
  rules,
) {
  let cursor = arrival;
  const schedule = [];
  for (const task of order) {
    let chosen = null;
    const pool = professionals[task.type] || [];
    const required = rules.some(
      (r) =>
        r.type === "professional" &&
        r.department === task.type &&
        r.strength === "required",
    );
    for (
      let start = cursor;
      start >= 0 && start <= actor.ready;
      start = roundToFiveMinutes(start - 5)
    ) {
      const end = start + task.duration;
      if (end > actor.ready) continue;
      const professional = selectProfessional(
        findAvailableProfessionals(pool, start, end, reservations),
        rules,
        task.type,
      );
      if ((pool.length || required) && !professional) continue;
      chosen = {
        ...task,
        actorId: actor.id,
        start,
        end,
        professionalId: professional?.id || null,
      };
      break;
    }
    if (!chosen || schedule.some((t) => overlaps(t, chosen))) return null;
    schedule.push(chosen);
    cursor = chosen.end;
  }
  // A backwards availability search can place a later task before an earlier one.
  // Hard rules must hold in actual chronological order as well as the proposed order.
  if (
    !validateCandidate(
      [...schedule].sort((a, b) => a.start - b.start),
      rules,
    ).valid
  )
    return null;
  return schedule;
}
export function generateSchedule({
  actors,
  professionals,
  rules = [],
  settings = {},
}) {
  const professionalSchedules = {},
    diagnostics = [];
  const sorted = actors
    .map((a, index) => ({ a, index }))
    .sort(
      (x, y) =>
        x.a.priority - y.a.priority ||
        x.a.ready - y.a.ready ||
        x.index - y.index,
    );
  const result = [];
  const seen = new Set();
  const professionalIds = Object.values(professionals)
    .flat()
    .map((p) => p.id);
  if (
    new Set(professionalIds).size !== professionalIds.length ||
    professionalIds.some((id) => !id)
  ) {
    return {
      success: false,
      actors: actors.map((a) => ({ ...a, schedule: [], arrival: null })),
      professionalSchedules,
      diagnostics: [{ type: "invalid-professionals" }],
    };
  }
  for (const { a } of sorted) {
    const actor = { ...a, schedule: [], arrival: null };
    result.push(actor);
    const tasks = DEPARTMENTS.flatMap((type) =>
      a.tasks.filter((t) => t.type === type && t.duration > 0),
    );
    const ids = [a.id, ...a.tasks.map((t) => t.id)];
    if (
      ids.some((id) => !id || seen.has(id)) ||
      new Set(ids).size !== ids.length ||
      !a.name.trim() ||
      !Number.isInteger(a.ready) ||
      a.ready < 0 ||
      a.ready >= 1440 ||
      !Number.isInteger(a.priority) ||
      a.priority < 1 ||
      a.tasks.some(
        (t) =>
          !Number.isInteger(t.duration) ||
          t.duration < 0 ||
          !DEPARTMENTS.includes(t.type) ||
          t.actorId !== a.id,
      ) ||
      new Set(tasks.map((t) => t.type)).size !== tasks.length
    ) {
      diagnostics.push({ type: "invalid-actor", actorId: a.id });
      continue;
    }
    ids.forEach((id) => seen.add(id));
    const effective = resolveRules(rules, a.rules, tasks),
      validation = validateRuleConsistency(
        effective,
        tasks.map((t) => t.type),
      );
    if (!validation.valid) {
      diagnostics.push(
        ...validation.diagnostics.map((d) => ({ ...d, actorId: a.id })),
      );
      continue;
    }
    const orders = candidateOrders(tasks, effective);
    const initial = roundToFiveMinutes(
      a.ready - tasks.reduce((sum, t) => sum + t.duration, 0),
    );
    for (let attempt = 0; attempt <= (settings.maxAttempts ?? 48); attempt++) {
      const arrival = initial - attempt * 5;
      if (arrival < 0 || (actor.arrival !== null && arrival < actor.arrival))
        break;
      for (const order of orders) {
        const schedule = scheduleCandidate(
          a,
          order,
          arrival,
          professionals,
          professionalSchedules,
          effective,
        );
        if (schedule) {
          const actualArrival = arrivalTime({ ...actor, schedule });
          // Compare actual arrivals, not just the initial estimate. A softer order must
          // not force an earlier call when another valid order fits later (Mario/Luigi).
          // Orders are preference-ranked: retain the first on equal actual arrivals.
          if (actor.arrival === null || actualArrival > actor.arrival) {
            actor.schedule = schedule;
            actor.arrival = actualArrival;
          }
        }
      }
      if (!tasks.length) break;
    }
    if (tasks.length && !actor.schedule.length) {
      const required = effective.filter(
        (r) => r.type === "professional" && r.strength === "required",
      );
      diagnostics.push(
        ...(required.length
          ? required.map((r) => ({
              type: "required-professional-unavailable",
              department: r.department,
              professionalId: r.professionalId,
            }))
          : [{ type: "cannot-finish-before-ready" }]
        ).map((d) => ({ ...d, actorId: a.id })),
      );
    } else {
      actor.arrival = arrivalTime(actor);
      actor.schedule.forEach((t) =>
        reserveProfessional(professionalSchedules, t),
      );
    }
  }
  return rebalanceOpening(
    {
      success: diagnostics.length === 0,
      actors: result,
      professionalSchedules,
      diagnostics,
    },
    { professionals, rules },
  );
}
