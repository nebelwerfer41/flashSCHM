import { overlaps } from "../utils/time.js";
export function isProfessionalAvailable(
  professional,
  start,
  end,
  reservations,
) {
  return !(reservations[professional.id] || []).some((slot) =>
    overlaps({ start, end }, slot),
  );
}
export function findAvailableProfessionals(
  professionals,
  start,
  end,
  reservations,
) {
  return professionals.filter((p) =>
    isProfessionalAvailable(p, start, end, reservations),
  );
}
export function selectProfessional(available, rules, department) {
  const relevant = rules.filter(
    (r) => r.type === "professional" && r.department === department,
  );
  const required = relevant.find((r) => r.strength === "required");
  if (required)
    return available.find((p) => p.id === required.professionalId) || null;
  const preferred = relevant.filter((r) => r.strength === "preferred");
  return (
    available
      .map((p, index) => ({
        p,
        index,
        score: preferred.filter((r) => r.professionalId === p.id).length,
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.p || null
  );
}
export function reserveProfessional(reservations, task) {
  if (task.professionalId)
    (reservations[task.professionalId] ||= []).push({ ...task });
}
