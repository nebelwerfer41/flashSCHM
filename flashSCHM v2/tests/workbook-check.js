// Optional integration check against the same SheetJS file loaded by index.html.
// Usage: node tests/workbook-check.js /absolute/path/to/xlsx.cjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createState, createActor } from "../js/state.js";
import { readWorkbook, writeWorkbook } from "../js/io/xlsx.js";
import { saveSchedule } from "../js/versions.js";
const XLSX = createRequire(import.meta.url)(resolve(process.argv[2]));
const state = createState();
state.settings.defaultReady = 555;
state.actors = Array.from({ length: 80 }, (_, i) =>
  createActor({ name: `Synthetic ${i}` }),
);
const scheduled = state.actors[0];
scheduled.tasks[0].duration = 15;
scheduled.arrival = 540;
scheduled.schedule = [{ ...scheduled.tasks[0], start: 540, end: 555, professionalId: state.professionals.trucco[0].id }];
saveSchedule(state, "First plan", "2026-10-03T10:00:00.000Z");
for (const bookType of ["xlsx"]) {
  const bytes = XLSX.write(writeWorkbook(XLSX, state), {
    type: "buffer",
    bookType,
    cellStyles: true,
  });
  assert.deepEqual(readWorkbook(XLSX, bytes), state);
  const workbook = XLSX.read(bytes, { type: "array", cellStyles: true });
  assert.equal(workbook.Sheets.Actors["!cols"][0].hidden, true);
  assert.equal(workbook.Workbook.Sheets[1].Hidden, 0);
  assert.equal(workbook.Workbook.Sheets[2].Hidden, 1);
  const readable = XLSX.utils.sheet_to_json(workbook.Sheets.Programmazioni);
  assert.equal(readable.length, 1);
  assert.equal(readable[0].Versione, "First plan");
  assert.equal(readable[0].Attore, "Synthetic 0");
  assert.equal(readable[0].Inizio, "09:00");
  assert.equal(readable[0].Professionista, "Fede");
  workbook.Sheets.Actors.B2.v = "Edited in Excel";
  XLSX.utils.sheet_add_json(
    workbook.Sheets.Actors,
    [{ ID: "", Nome: "Added in Excel", OrarioPronti: "", DurataTrucco: 15 }],
    {
      header: [
        "ID",
        "Nome",
        "OrarioPronti",
        "PrioritaAttore",
        "DurataTrucco",
        "DurataCapelli",
        "DurataCostumi",
      ],
      skipHeader: true,
      origin: -1,
    },
  );
  const editedBytes = XLSX.write(workbook, { type: "buffer", bookType, cellStyles: true });
  const edited = readWorkbook(XLSX, editedBytes);
  assert.equal(edited.actors[0].name, "Edited in Excel");
  assert.equal(edited.actors.at(-1).ready, 555);
  assert.equal(edited.savedSchedules[0].plan.actors[0].name, "Synthetic 0");
}
const legacy = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  legacy,
  XLSX.utils.json_to_sheet([
    {
      Nome: "Synthetic - legacy",
      OrarioPronti: "10:00",
      DurataTrucco: 15,
      ProfessionistaTrucco: 0,
    },
  ]),
  "Actors",
);
for (const bookType of ["xlsx", "biff8"]) {
  const imported = readWorkbook(
    XLSX,
    XLSX.write(legacy, { type: "buffer", bookType }),
  );
  assert.equal(imported.actors[0].rules.add[0].strength, "required");
  assert.equal(
    imported.actors[0].rules.add[0].professionalId,
    imported.professionals.trucco[0].id,
  );
}
console.log(
  "Workbook integration passed: versioned XLSX, chunked metadata, legacy XLSX and XLS/BIFF8 index zero.",
);
