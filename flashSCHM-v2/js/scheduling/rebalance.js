import { DEPARTMENTS } from "../state.js";
import { isProfessionalAvailable, reserveProfessional } from "./professionals.js";
import { candidateOrders, resolveRules, scoreCandidate } from "./rules.js";

// A bounded search keeps generation responsive for large plans. The duration/READY
// bound is the latest opening any valid schedule could possibly achieve.
const MAX_SEARCH_NODES = 120000;

const taskDuration = (actor) =>
  actor.tasks.reduce((sum, task) => sum + Math.max(0, task.duration), 0);

function availablePeople(pool, task, start, end, reservations, rules) {
  const relevant = rules.filter(
    (rule) => rule.type === "professional" && rule.department === task.type,
  );
  const required = relevant.find((rule) => rule.strength === "required");
  if (!pool.length) return required ? [] : [null];
  return pool
    .map((person, index) => ({
      person,
      index,
      preference: relevant.filter(
        (rule) =>
          rule.strength === "preferred" && rule.professionalId === person.id,
      ).length,
    }))
    .filter(
      ({ person }) =>
        (!required || person.id === required.professionalId) &&
        isProfessionalAvailable(person, start, end, reservations),
    )
    .sort((a, b) => b.preference - a.preference || a.index - b.index)
    .map(({ person }) => person);
}

function startsBetween(latest, earliest) {
  const values = [];
  for (let start = latest; start >= earliest; start -= 5) values.push(start);
  if (values.length && values.at(-1) !== earliest) values.push(earliest);
  return values;
}

function searchAtOpening(actors, professionals, rules, opening, budget, limit) {
  const entries = actors
    .map((actor, index) => {
      const tasks = DEPARTMENTS.flatMap((type) =>
        actor.tasks.filter((task) => task.type === type && task.duration > 0),
      );
      const effective = resolveRules(rules, actor.rules, tasks);
      const orders = candidateOrders(tasks, effective);
      return {
        actor,
        index,
        tasks,
        total: taskDuration(actor),
        orders,
        bestOrderScore: scoreCandidate(orders[0], effective),
        rules: effective,
      };
    })
    .filter((entry) => entry.tasks.length)
    // The actors with the least room to move constrain the opening first.
    .sort(
      (a, b) =>
        a.actor.ready - a.total - (b.actor.ready - b.total) ||
        a.actor.priority - b.actor.priority ||
        a.index - b.index,
    );
  const reservations = {};
  const placed = new Map();
  let best = null;
  let bestScore = limit.score;
  let bestPreference = limit.preference;
  const optimal = () => bestScore === 0 && bestPreference === 0;

  function placeActor(index, score, preference) {
    if (
      budget.remaining <= 0 ||
      optimal() ||
      score > bestScore ||
      (score === bestScore && preference >= bestPreference)
    ) return;
    if (index === entries.length) {
      bestScore = score;
      bestPreference = preference;
      best = new Map(
        [...placed].map(([id, schedule]) => [
          id,
          schedule.map((task) => ({ ...task })),
        ]),
      );
      return;
    }
    const { actor, total, orders, bestOrderScore, rules: effective } =
      entries[index];
    if (actor.ready - total < opening) return;
    for (const order of orders) {
      const suffix = order.map((_, i) =>
        order.slice(i).reduce((sum, task) => sum + task.duration, 0),
      );
      const schedule = [];
      function placeTask(position, cursor) {
        if (budget.remaining <= 0 || optimal()) return;
        if (position === order.length) {
          const first = schedule[0].start;
          const extra = actor.ready - first - total;
          // Priority 1 has the greatest weight. The day opening was fixed before
          // this score is considered, so actor priority cannot start the day earlier.
          const nextScore = score + extra / actor.priority;
          const nextPreference =
            preference + scoreCandidate(order, effective) - bestOrderScore;
          if (
            nextScore > bestScore ||
            (nextScore === bestScore && nextPreference >= bestPreference)
          ) return;
          placed.set(actor.id, schedule);
          placeActor(index + 1, nextScore, nextPreference);
          placed.delete(actor.id);
          return;
        }
        const task = order[position];
        const earliest = Math.max(cursor, opening);
        const latest = actor.ready - suffix[position];
        if (latest < earliest) return;
        for (const start of startsBetween(latest, earliest)) {
          const end = start + task.duration;
          const pool = professionals[task.type] || [];
          for (const person of availablePeople(
            pool,
            task,
            start,
            end,
            reservations,
            effective,
          )) {
            if (--budget.remaining < 0) return;
            const scheduled = {
              ...task,
              actorId: actor.id,
              start,
              end,
              professionalId: person?.id || null,
            };
            schedule.push(scheduled);
            reserveProfessional(reservations, scheduled);
            placeTask(position + 1, end);
            if (person) reservations[person.id].pop();
            schedule.pop();
            if (optimal() || budget.remaining <= 0) return;
          }
        }
      }
      placeTask(0, opening);
      if (optimal() || budget.remaining <= 0) break;
    }
  }

  placeActor(0, 0, 0);
  return best;
}

export function rebalanceOpening(result, input) {
  if (!result.success) return result;
  const active = result.actors.filter((actor) => actor.schedule.length);
  if (!active.length) return result;
  const currentOpening = Math.min(...active.map((actor) => actor.arrival));
  const latestPossible = Math.min(
    ...active.map((actor) =>
      Math.floor((actor.ready - taskDuration(actor)) / 5) * 5,
    ),
  );
  const currentScore = active.reduce(
    (score, actor) =>
      score +
      (actor.ready - actor.arrival - taskDuration(actor)) / actor.priority,
    0,
  );
  const currentPreference = active.reduce((sum, actor) => {
    const tasks = actor.tasks.filter((task) => task.duration > 0);
    const effective = resolveRules(input.rules || [], actor.rules, tasks);
    const preferred = candidateOrders(tasks, effective)[0];
    return (
      sum +
      scoreCandidate(
        [...actor.schedule].sort((a, b) => a.start - b.start),
        effective,
      ) -
      scoreCandidate(preferred, effective)
    );
  }, 0);
  if (
    latestPossible <= currentOpening &&
    currentScore === 0 &&
    currentPreference === 0
  ) return result;

  const budget = { remaining: MAX_SEARCH_NODES };
  for (
    let opening = latestPossible;
    opening >= currentOpening && budget.remaining > 0;
    opening -= 5
  ) {
    const placed = searchAtOpening(
      result.actors,
      input.professionals,
      input.rules || [],
      opening,
      budget,
      opening > currentOpening
        ? { score: Infinity, preference: Infinity }
        : { score: currentScore, preference: currentPreference },
    );
    if (!placed) continue;
    const actors = result.actors.map((actor) => {
      const schedule = placed.get(actor.id);
      return schedule
        ? {
            ...actor,
            schedule,
            arrival: Math.min(...schedule.map((t) => t.start)),
          }
        : actor;
    });
    const professionalSchedules = {};
    actors.forEach((actor) =>
      actor.schedule.forEach((task) =>
        reserveProfessional(professionalSchedules, task),
      ),
    );
    return { ...result, actors, professionalSchedules };
  }
  return result;
}
