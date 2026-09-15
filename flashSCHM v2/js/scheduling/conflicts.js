import { overlaps, arrivalTime } from "../utils/time.js";
import { resolveRules, validateCandidate } from "./rules.js";
export function detectConflicts(actors, globalRules = []) {
  const tasks = actors.flatMap((a) => a.schedule),
    conflicts = [];
  for (let i = 0; i < tasks.length; i++)
    for (let j = i + 1; j < tasks.length; j++) {
      const a = tasks[i],
        b = tasks[j];
      if (!overlaps(a, b)) continue;
      if (a.actorId === b.actorId)
        conflicts.push({
          type: "actor-overlap",
          actorId: a.actorId,
          taskIds: [a.id, b.id],
        });
      if (a.professionalId && a.professionalId === b.professionalId)
        conflicts.push({
          type: "professional-overlap",
          professionalId: a.professionalId,
          taskIds: [a.id, b.id],
        });
    }
  for (const actor of actors) {
    const rules = resolveRules(globalRules, actor.rules, actor.schedule);
    for (const t of actor.schedule) {
      if (t.end > actor.ready)
        conflicts.push({
          type: "after-ready",
          actorId: actor.id,
          taskIds: [t.id],
        });
      if (
        rules.some(
          (r) =>
            r.type === "professional" &&
            r.strength === "required" &&
            r.department === t.type &&
            r.professionalId !== t.professionalId,
        )
      )
        conflicts.push({
          type: "required-professional-violated",
          actorId: actor.id,
          taskIds: [t.id],
        });
    }
    const validation = validateCandidate(
      [...actor.schedule].sort((a, b) => a.start - b.start),
      rules,
    );
    if (!validation.valid)
      conflicts.push({
        type: "required-order-violated",
        actorId: actor.id,
        taskIds: actor.schedule.map((t) => t.id),
      });
  }
  return conflicts;
}
/** Manual edits intentionally retain conflicts for the operator to resolve. */
export function moveTask(
  state,
  { actorId, taskId, start, end, professionalId },
) {
  const actor = state.actors.find((a) => a.id === actorId),
    task = actor?.schedule.find((t) => t.id === taskId);
  if (
    !task ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end > 1440 ||
    start >= end
  )
    return { valid: false };
  const pool = state.professionals[task.type];
  if (
    professionalId
      ? !pool.some((p) => p.id === professionalId)
      : pool.length > 0
  )
    return { valid: false };
  task.start = start;
  task.end = end;
  task.professionalId = professionalId;
  actor.arrival = arrivalTime(actor);
  return { valid: true, conflicts: detectConflicts(state.actors, state.rules) };
}
