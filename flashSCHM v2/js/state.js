export const DEPARTMENTS = ["trucco", "capelli", "costumi"];
export const LABELS = {
  trucco: "Trucco",
  capelli: "Capelli",
  costumi: "Costumi",
};
export const DEFAULT_READY = 600;
export { newId } from "./utils/ids.js";
import { newId } from "./utils/ids.js";
export function createActor(data = {}) {
  const id = data.id || newId();
  return {
    id,
    name: "",
    ready: DEFAULT_READY,
    priority: 1,
    rules: { add: [], disabled: [] },
    schedule: [],
    ...data,
    tasks:
      data.tasks ||
      DEPARTMENTS.map((type) => ({
        id: newId(),
        actorId: id,
        type,
        duration: 0,
      })),
  };
}
export function createState() {
  return {
    actors: [],
    professionals: {
      trucco: ["Fede", "Flavia"].map((name) => ({ id: newId(), name })),
      capelli: ["Ciro", "Lori"].map((name) => ({ id: newId(), name })),
      costumi: [],
    },
    settings: { maxAttempts: 48, defaultReady: DEFAULT_READY },
    rules: [
      {
        id: "default-order",
        type: "order",
        order: ["costumi", "capelli", "trucco"],
        strength: "preferred",
      },
    ],
    diagnostics: [],
    savedSchedules: [],
  };
}
