// Optional integration check against the same SheetJS file loaded by index.html.
// Usage: node tests/workbook-check.js /absolute/path/to/xlsx.cjs
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createState, createActor } from "../js/state.js";
import { readWorkbook, writeWorkbook } from "../js/io/xlsx.js";
const XLSX = createRequire(import.meta.url)(resolve(process.argv[2]));
const state = createState();
state.actors = Array.from({ length: 80 }, (_, i) =>
  createActor({ name: `Synthetic ${i}` }),
);
for (const bookType of ["xlsx"]) {
  const bytes = XLSX.write(writeWorkbook(XLSX, state), {
    type: "buffer",
    bookType,
  });
  assert.deepEqual(readWorkbook(XLSX, bytes), state);
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
