import { newId } from "./state.js";

const copy = (value) => JSON.parse(JSON.stringify(value));

export function snapshotPlan(state) {
  const { savedSchedules, ...plan } = state;
  return copy(plan);
}

export function saveSchedule(state, name, savedAt = new Date().toISOString()) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Inserisci un nome per la versione.");
  const version = {
    id: newId(),
    name: trimmed,
    savedAt,
    plan: snapshotPlan(state),
  };
  state.savedSchedules.push(version);
  return version;
}

export function openSchedule(state, id) {
  const version = state.savedSchedules.find((item) => item.id === id);
  if (!version) throw new Error("Versione non trovata.");
  return { ...copy(version.plan), savedSchedules: state.savedSchedules };
}

export function deleteSchedule(state, id) {
  const index = state.savedSchedules.findIndex((item) => item.id === id);
  if (index < 0) throw new Error("Versione non trovata.");
  state.savedSchedules.splice(index, 1);
}
