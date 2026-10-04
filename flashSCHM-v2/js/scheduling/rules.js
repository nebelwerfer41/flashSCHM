import { DEPARTMENTS } from "../state.js";

/** Additive by default. Disable inherited rules by ID; an added rule with the same ID replaces it. */
export function resolveRules(
  globalRules = [],
  actorRules = {},
  availableTasks = DEPARTMENTS,
) {
  const types = new Set(
    availableTasks.map((t) => (typeof t === "string" ? t : t.type)),
  );
  const added = actorRules.add || [],
    disabled = new Set(actorRules.disabled || []);
  const replaced = new Set(added.map((r) => r.id));
  return [
    ...globalRules.filter((r) => !disabled.has(r.id) && !replaced.has(r.id)),
    ...added,
  ]
    .filter((r) => (r.type === "professional" ? types.has(r.department) : true))
    .map((r) => normalizeRule(r, types));
}
function normalizeRule(rule, types) {
  const r = { ...rule };
  if (r.type === "after") {
    r.type = "before";
    [r.first, r.second] = [r.second, r.first];
  }
  let edges = [];
  if (r.type === "before") edges = [[r.first, r.second]];
  if (r.type === "first")
    edges = [...types]
      .filter((t) => t !== r.department)
      .map((t) => [r.department, t]);
  if (r.type === "last")
    edges = [...types]
      .filter((t) => t !== r.department)
      .map((t) => [t, r.department]);
  if (r.type === "order") {
    r.order = (r.order || []).filter((t) => types.has(t));
    edges = r.order.flatMap((a, i) => r.order.slice(i + 1).map((b) => [a, b]));
  }
  return {
    ...r,
    edges: edges.filter(([a, b]) => types.has(a) && types.has(b)),
  };
}
export function validateRuleConsistency(rules, types) {
  const diagnostics = [];
  const allowed = new Set(["before", "first", "last", "order", "professional"]);
  for (const r of rules) {
    if (
      !allowed.has(r.type) ||
      !["required", "preferred"].includes(r.strength) ||
      (r.type === "before" &&
        (![r.first, r.second].every((t) => DEPARTMENTS.includes(t)) ||
          r.first === r.second)) ||
      (["first", "last", "professional"].includes(r.type) &&
        !DEPARTMENTS.includes(r.department)) ||
      (r.type === "order" &&
        (!Array.isArray(r.order) ||
          new Set(r.order).size !== r.order.length)) ||
      (r.type === "professional" && !r.professionalId)
    )
      diagnostics.push({ type: "invalid-rule", ruleId: r.id });
  }
  const edges = rules
    .filter((r) => r.strength === "required")
    .flatMap((r) => r.edges);
  const visiting = new Set(),
    done = new Set();
  const cycle = (node) => {
    if (visiting.has(node)) return true;
    if (done.has(node)) return false;
    visiting.add(node);
    if (edges.filter(([a]) => a === node).some(([, b]) => cycle(b)))
      return true;
    visiting.delete(node);
    done.add(node);
    return false;
  };
  if (types.some((t) => cycle(t)))
    diagnostics.push({
      type: "contradictory-order-constraints",
      rules: rules
        .filter((r) => r.strength === "required" && r.edges.length)
        .map((r) => r.id),
    });
  for (const department of types) {
    const ids = new Set(
      rules
        .filter(
          (r) =>
            r.type === "professional" &&
            r.strength === "required" &&
            r.department === department,
        )
        .map((r) => r.professionalId),
    );
    if (ids.size > 1)
      diagnostics.push({
        type: "contradictory-professional-constraints",
        department,
      });
  }
  return { valid: diagnostics.length === 0, diagnostics };
}
export function validateCandidate(order, rules) {
  const positions = new Map(
    order.map((t, i) => [typeof t === "string" ? t : t.type, i]),
  );
  const violations = rules.filter(
    (r) =>
      r.strength === "required" &&
      r.edges.some(([a, b]) => positions.get(a) >= positions.get(b)),
  );
  return { valid: violations.length === 0, violations };
}
export function scoreCandidate(order, rules) {
  const types = order.map((t) => (typeof t === "string" ? t : t.type));
  return rules
    .filter((r) => r.strength === "preferred")
    .reduce((score, r) => {
      // Weighted positions preserve the legacy priority ordering, including equal-score ties.
      if (r.type === "order" && r.legacyWeights)
        return (
          score +
          types.reduce(
            (sum, t, i) => sum + (r.legacyWeights[t] || 99) * (i + 1),
            0,
          )
        );
      if (r.type === "order")
        return (
          score +
          types.reduce(
            (sum, t, i) =>
              sum + Math.max(0, r.order.indexOf(t)) * (types.length - i),
            0,
          )
        );
      return (
        score +
        r.edges.filter(([a, b]) => types.indexOf(a) > types.indexOf(b)).length
      );
    }, 0);
}
export function generateTaskPermutations(tasks) {
  if (tasks.length <= 1) return [tasks.slice()];
  return tasks.flatMap((task, i) =>
    generateTaskPermutations(tasks.filter((_, j) => j !== i)).map((rest) => [
      task,
      ...rest,
    ]),
  );
}
export function candidateOrders(tasks, rules) {
  return generateTaskPermutations(tasks)
    .map((order, index) => ({
      order,
      index,
      score: scoreCandidate(order, rules),
    }))
    .filter((c) => validateCandidate(c.order, rules).valid)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((c) => c.order);
}
