import { createState, createActor, DEPARTMENTS, newId } from "../state.js";
import { parseTime, formatTime } from "../utils/time.js";

const durationColumns = {
  trucco: "DurataTrucco",
  capelli: "DurataCapelli",
  costumi: "DurataCostumi",
};
const professionalColumns = {
  trucco: "ProfessionistaTrucco",
  capelli: "ProfessionistaCapelli",
};
function importedTime(value) {
  if (typeof value === "number" && value >= 0 && value < 1)
    return Math.round(value * 1440) % 1440;
  return parseTime(String(value));
}
const actorColumns = [
  "ID",
  "Nome",
  "OrarioPronti",
  "PrioritaAttore",
  "DurataTrucco",
  "DurataCapelli",
  "DurataCostumi",
];

function editableInteger(value, fallback, minimum, label, rowNumber) {
  if (value === "" || value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum)
    throw new Error(`Actors, riga ${rowNumber}: ${label} non valido.`);
  return number;
}

function applyActorRows(state, rows) {
  if (!Array.isArray(rows)) throw new Error("missing-actors-sheet");
  const byId = new Map(state.actors.map((actor) => [actor.id, actor]));
  const seen = new Set();
  let scheduleChanged = false;
  const actors = rows
    .filter((row) => actorColumns.some((column) => String(row[column] ?? "").trim()))
    .map((row, index) => {
      const rowNumber = Number.isInteger(row.__rowNum__)
        ? row.__rowNum__ + 1
        : index + 2;
      const id = String(row.ID ?? "").trim();
      if (id && (!byId.has(id) || seen.has(id)))
        throw new Error(`Actors, riga ${rowNumber}: ID attore sconosciuto o duplicato.`);
      if (id) seen.add(id);
      const actor = id ? byId.get(id) : createActor();
      let ready;
      try {
        ready =
          !id && (row.OrarioPronti === "" || row.OrarioPronti == null)
            ? actor.ready
            : importedTime(row.OrarioPronti);
      } catch {
        throw new Error(`Actors, riga ${rowNumber}: OrarioPronti non valido.`);
      }
      const priority = editableInteger(
        row.PrioritaAttore,
        1,
        1,
        "PrioritaAttore",
        rowNumber,
      );
      const durations = Object.fromEntries(
        DEPARTMENTS.map((type) => [
          type,
          editableInteger(
            row[durationColumns[type]],
            0,
            0,
            durationColumns[type],
            rowNumber,
          ),
        ]),
      );
      if (
        !id ||
        actor.ready !== ready ||
        actor.priority !== priority ||
        actor.tasks.some((task) => task.duration !== durations[task.type])
      )
        scheduleChanged = true;
      actor.name = String(row.Nome ?? "");
      actor.ready = ready;
      actor.priority = priority;
      for (const task of actor.tasks) task.duration = durations[task.type];
      return actor;
    });
  if (
    actors.length !== state.actors.length ||
    actors.some((actor, index) => actor.id !== state.actors[index].id)
  )
    scheduleChanged = true;
  state.actors = actors;
  if (scheduleChanged) {
    for (const actor of actors) {
      actor.schedule = [];
      actor.arrival = null;
    }
    state.diagnostics = [];
  }
  return state;
}

/** Pure row conversion; spreadsheet library belongs only to the thin workbook adapter below. */
export function parseRows({ Actors, Depts = [], FlashSCHM = [] }) {
  if (FlashSCHM.length) {
    const version = Number(FlashSCHM[0].Version);
    if (![2, 3].includes(version))
      throw new Error("unsupported-file-version");
    const state = JSON.parse(FlashSCHM.map((row) => row.Data).join(""));
    validateProject(state);
    if (version === 3 || (version === 2 && Actors)) {
      let editableRows = Actors;
      if (version === 2) {
        if (Actors.length !== state.actors.length)
          throw new Error("Per aggiungere o eliminare attori, riesporta il progetto con questa versione dell’app.");
        const namePositions = new Map();
        for (const [index, actor] of state.actors.entries()) {
          if (namePositions.has(actor.name)) namePositions.set(actor.name, null);
          else namePositions.set(actor.name, index);
        }
        if (
          Actors.some(
            (row, index) =>
              namePositions.has(String(row.Nome ?? "")) &&
              namePositions.get(String(row.Nome ?? "")) !== null &&
              namePositions.get(String(row.Nome ?? "")) !== index,
          )
        )
          throw new Error("Per riordinare gli attori, riesporta il progetto con questa versione dell’app.");
        editableRows = Actors.map((row, index) => ({
          ...row,
          ID: state.actors[index].id,
        }));
      }
      applyActorRows(state, editableRows);
      validateProject(state);
    }
    return state;
  }
  const state = createState(),
    priorities = { trucco: 1, capelli: 2, costumi: 3 };
  for (const row of Depts) {
    const type = String(row.Reparto).toLowerCase();
    if (!DEPARTMENTS.includes(type)) continue;
    const count = Number(row.NumeroProfessionisti);
    if (!Number.isInteger(count) || count < 0 || count > 1000)
      throw new Error("invalid-professionals");
    const names = String(row.NomiProfessionisti || "")
      .split(",")
      .map((n) => n.trim())
      .filter(Boolean);
    state.professionals[type] = Array.from({ length: count }, (_, i) => ({
      id: newId(),
      name: names[i] || `${type[0].toUpperCase()} ${i + 1}`,
    }));
    priorities[type] = Number(row.Priorita) || 3;
  }
  // Legacy UI replaced duplicate priorities with 1/2/3.
  if (new Set(Object.values(priorities)).size < 3)
    Object.assign(priorities, { trucco: 1, capelli: 2, costumi: 3 });
  // Retain numeric weights for exact legacy permutation ranking, even nonstandard values.
  state.rules = [
    {
      id: "legacy-order",
      type: "order",
      order: DEPARTMENTS.slice().sort((a, b) => priorities[b] - priorities[a]),
      strength: "preferred",
      legacyWeights: priorities,
    },
  ];
  for (const row of Actors || []) {
    const actor = createActor({
      name: String(row.Nome || ""),
      ready: importedTime(row.OrarioPronti),
      priority: Number(row.PrioritaAttore) || 1,
    });
    for (const task of actor.tasks)
      task.duration = Number(row[durationColumns[task.type]]) || 0;
    for (const [department, column] of Object.entries(professionalColumns)) {
      const value = row[column];
      if (value !== undefined && value !== null && String(value) !== "") {
        const index = Number(value),
          professional = state.professionals[department][index];
        actor.rules.add.push({
          id: newId(),
          type: "professional",
          department,
          strength: "required",
          professionalId: professional?.id || `missing-${department}-${value}`,
        });
      }
    }
    state.actors.push(actor);
  }
  validateProject(state);
  return state;
}
export function serializeRows(state) {
  validateProject(state);
  const order = state.rules.find(
    (r) => r.type === "order" && r.strength === "preferred",
  );
  return {
    Actors: state.actors.map((a) => {
      const row = {
        ID: a.id,
        Nome: a.name,
        OrarioPronti: formatTime(a.ready),
        PrioritaAttore: a.priority,
      };
      for (const type of DEPARTMENTS)
        row[durationColumns[type]] =
          a.tasks.find((t) => t.type === type)?.duration || 0;
      return row;
    }),
    Depts: DEPARTMENTS.map((type) => ({
      Reparto: type,
      NumeroProfessionisti: state.professionals[type].length,
      NomiProfessionisti: state.professionals[type]
        .map((p) => p.name)
        .join(", "),
      Priorita:
        order?.legacyWeights?.[type] ||
        (order ? 3 - order.order.indexOf(type) : DEPARTMENTS.indexOf(type) + 1),
    })),
    FlashSCHM: (JSON.stringify(state).match(/[\s\S]{1,30000}/g) || []).map(
      (Data) => ({ Version: 3, Data }),
    ),
  };
}
export function validateProject(state) {
  if (
    !state ||
    !Array.isArray(state.actors) ||
    !Array.isArray(state.rules) ||
    !state.professionals ||
    !state.settings
  )
    throw new Error("invalid-project");
  const ids = new Set();
  const identify = (id) => {
    if (typeof id !== "string" || !id || ids.has(id))
      throw new Error("duplicate-or-missing-id");
    ids.add(id);
  };
  for (const type of DEPARTMENTS) {
    if (!Array.isArray(state.professionals[type]))
      throw new Error("invalid-professionals");
    for (const p of state.professionals[type]) {
      identify(p.id);
      if (typeof p.name !== "string") throw new Error("invalid-professionals");
    }
  }
  const checkRules = (rules) => {
    if (!Array.isArray(rules)) throw new Error("invalid-rule");
    const ruleIds = new Set();
    for (const r of rules) {
      if (
        !r ||
        typeof r.id !== "string" ||
        !r.id ||
        ruleIds.has(r.id) ||
        !["required", "preferred"].includes(r.strength) ||
        !["before", "after", "first", "last", "order", "professional"].includes(
          r.type,
        )
      )
        throw new Error("invalid-rule");
      ruleIds.add(r.id);
      if (
        ["before", "after"].includes(r.type) &&
        (!DEPARTMENTS.includes(r.first) || !DEPARTMENTS.includes(r.second))
      )
        throw new Error("invalid-rule");
      if (
        ["first", "last", "professional"].includes(r.type) &&
        !DEPARTMENTS.includes(r.department)
      )
        throw new Error("invalid-rule");
      if (r.type === "professional" && typeof r.professionalId !== "string")
        throw new Error("invalid-rule");
      if (
        r.type === "order" &&
        (!Array.isArray(r.order) ||
          r.order.some((t) => !DEPARTMENTS.includes(t)) ||
          new Set(r.order).size !== r.order.length)
      )
        throw new Error("invalid-rule");
    }
  };
  checkRules(state.rules);
  for (const a of state.actors) {
    identify(a.id);
    if (
      typeof a.name !== "string" ||
      !Number.isInteger(a.ready) ||
      a.ready < 0 ||
      a.ready >= 1440 ||
      !Number.isInteger(a.priority) ||
      a.priority < 1 ||
      !Array.isArray(a.tasks) ||
      !Array.isArray(a.schedule) ||
      !a.rules ||
      !Array.isArray(a.rules.disabled)
    )
      throw new Error("invalid-actor");
    checkRules(a.rules.add);
    for (const t of a.tasks) {
      identify(t.id);
      if (
        t.actorId !== a.id ||
        !DEPARTMENTS.includes(t.type) ||
        !Number.isInteger(t.duration) ||
        t.duration < 0
      )
        throw new Error("invalid-task");
    }
    const scheduled = new Set();
    for (const t of a.schedule) {
      if (
        scheduled.has(t.id) ||
        !a.tasks.some(
          (source) => source.id === t.id && source.type === t.type,
        ) ||
        t.actorId !== a.id ||
        !Number.isInteger(t.start) ||
        !Number.isInteger(t.end) ||
        t.start < 0 ||
        t.end > 1440 ||
        t.start >= t.end
      )
        throw new Error("invalid-schedule");
      scheduled.add(t.id);
    }
  }
}
export function readWorkbook(XLSX, buffer) {
  const workbook = XLSX.read(buffer, { type: "array" }),
    rows = {};
  if (!workbook.Sheets.Actors && !workbook.Sheets.FlashSCHM)
    throw new Error("missing-actors-sheet");
  for (const name of ["Actors", "Depts", "FlashSCHM"])
    if (workbook.Sheets[name])
      rows[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { defval: "" });
  return parseRows(rows);
}
export function writeWorkbook(XLSX, state) {
  const book = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(serializeRows(state))) {
    const sheet =
      name === "Actors" && rows.length === 0
        ? XLSX.utils.aoa_to_sheet([actorColumns])
        : XLSX.utils.json_to_sheet(
            rows,
            name === "Actors" ? { header: actorColumns } : undefined,
          );
    if (name === "Actors") {
      sheet["!cols"] = [
        { hidden: true },
        { wch: 26 },
        { wch: 17 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
        { wch: 16 },
      ];
      if (rows.length) sheet["!autofilter"] = { ref: sheet["!ref"] };
    }
    XLSX.utils.book_append_sheet(book, sheet, name);
  }
  book.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }, { Hidden: 1 }] };
  return book;
}
