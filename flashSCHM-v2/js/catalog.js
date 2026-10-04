import { createActor, DEPARTMENTS } from "./state.js";

export const CATALOG_COLUMNS = [
  "ID", "Nome", "DurataTrucco", "DurataCapelli", "DurataCostumi",
];
const DURATION_COLUMNS = {
  trucco: "DurataTrucco",
  capelli: "DurataCapelli",
  costumi: "DurataCostumi",
};

export function validateCatalog(catalog) {
  if (!Array.isArray(catalog)) throw new Error("catalogo non valido");
  const seen = new Set();
  for (const entry of catalog) {
    if (
      !entry || typeof entry.id !== "string" || !entry.id.trim() ||
      seen.has(entry.id) || typeof entry.name !== "string" ||
      !entry.name.trim() || !entry.durations ||
      DEPARTMENTS.some((type) =>
        !Number.isInteger(entry.durations[type]) || entry.durations[type] < 0
      )
    ) throw new Error("catalogo non valido: ID, nome o durate mancanti o duplicati");
    seen.add(entry.id);
  }
}

export function parseCatalogRows(rows) {
  if (!Array.isArray(rows)) throw new Error("Scheda Catalogo mancante.");
  const seen = new Set();
  const entries = rows
    .filter((row) => CATALOG_COLUMNS.some((column) => String(row[column] ?? "").trim()))
    .map((row, index) => {
      const line = Number.isInteger(row.__rowNum__) ? row.__rowNum__ + 1 : index + 2;
      const id = String(row.ID ?? "").trim();
      const name = String(row.Nome ?? "").trim();
      if (!id || !name) throw new Error(`Catalogo, riga ${line}: ID e Nome obbligatori.`);
      if (seen.has(id)) throw new Error(`Catalogo, riga ${line}: ID duplicato.`);
      seen.add(id);
      const durations = {};
      for (const type of DEPARTMENTS) {
        const column = DURATION_COLUMNS[type];
        const value = row[column];
        const number = value === "" || value == null ? 0 : Number(value);
        if (!Number.isInteger(number) || number < 0)
          throw new Error(`Catalogo, riga ${line}: ${column} non valido.`);
        durations[type] = number;
      }
      return { id, name, durations };
    });
  validateCatalog(entries);
  return entries;
}

export function serializeCatalogRows(catalog) {
  validateCatalog(catalog);
  return catalog.map((entry) => ({
    ID: entry.id,
    Nome: entry.name,
    ...Object.fromEntries(DEPARTMENTS.map((type) => [
      DURATION_COLUMNS[type], entry.durations[type],
    ])),
  }));
}

export function catalogImportPreview(catalog, incoming) {
  validateCatalog(catalog);
  validateCatalog(incoming);
  const existing = new Map(catalog.map((entry) => [entry.id, entry]));
  return incoming.map((entry) => ({
    ...entry,
    status: existing.has(entry.id) ? "existing" : "new",
  }));
}

export function applyCatalogImport(catalog, incoming, duplicateAction) {
  const preview = catalogImportPreview(catalog, incoming);
  if (preview.some((entry) => entry.status === "existing") &&
      !["replace", "keep"].includes(duplicateAction))
    throw new Error("Scegli come gestire gli ID già presenti.");
  const next = catalog.map((entry) => ({ ...entry, durations: { ...entry.durations } }));
  const positions = new Map(next.map((entry, index) => [entry.id, index]));
  let added = 0, replaced = 0, kept = 0;
  for (const entry of incoming) {
    const copy = { ...entry, durations: { ...entry.durations } };
    if (!positions.has(entry.id)) {
      positions.set(entry.id, next.length);
      next.push(copy);
      added++;
    } else if (duplicateAction === "replace") {
      next[positions.get(entry.id)] = copy;
      replaced++;
    } else kept++;
  }
  return { catalog: next, added, replaced, kept };
}

export function addCatalogActorsToPlan(state, ids) {
  const selected = new Set(ids);
  if (selected.size !== ids.length || !selected.size)
    throw new Error("Seleziona almeno un attore del catalogo.");
  const chosen = Array.from(selected, (id) =>
    state.actorCatalog.find((entry) => entry.id === id));
  if (chosen.some((entry) => !entry)) throw new Error("Attore del catalogo non trovato.");
  if (chosen.some((entry) => state.actors.some((actor) => actor.catalogId === entry.id)))
    throw new Error("Un attore selezionato è già nel piano.");
  const actors = chosen.map((entry) => {
    const actor = createActor({
      name: entry.name,
      ready: state.settings.defaultReady,
      catalogId: entry.id,
    });
    for (const task of actor.tasks) task.duration = entry.durations[task.type];
    return actor;
  });
  state.actors.push(...actors);
  return actors;
}
