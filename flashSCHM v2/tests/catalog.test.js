import test from "node:test";
import assert from "node:assert/strict";
import { createState } from "../js/state.js";
import {
  parseCatalogRows, serializeCatalogRows, catalogImportPreview,
  applyCatalogImport, addCatalogActorsToPlan,
} from "../js/catalog.js";
import { parseRows, serializeRows } from "../js/io/xlsx.js";
import { saveSchedule, openSchedule } from "../js/versions.js";

const rows = [
  { ID: "cast-001", Nome: "Mario", DurataTrucco: 20, DurataCapelli: 15, DurataCostumi: 10 },
  { ID: "cast-002", Nome: "Luigi", DurataTrucco: 25, DurataCapelli: 0, DurataCostumi: 5 },
];

test("catalog rows require stable unique IDs, names and valid durations", () => {
  const catalog = parseCatalogRows(rows);
  assert.deepEqual(serializeCatalogRows(catalog), rows);
  assert.throws(() => parseCatalogRows([{ ...rows[0], ID: "" }]), /ID e Nome/);
  assert.throws(() => parseCatalogRows([{ ...rows[0], Nome: "" }]), /ID e Nome/);
  assert.throws(() => parseCatalogRows([{ ...rows[0], DurataTrucco: -1 }]), /DurataTrucco/);
  assert.throws(() => parseCatalogRows([{ ...rows[0], DurataCapelli: 1.5 }]), /DurataCapelli/);
  assert.throws(() => parseCatalogRows([rows[0], rows[0]]), /ID duplicato/);
});

test("duplicate catalog IDs require an explicit keep or replace decision", () => {
  const original = parseCatalogRows([rows[0]]);
  const incoming = parseCatalogRows([{ ...rows[0], Nome: "Mario Updated" }, rows[1]]);
  assert.deepEqual(catalogImportPreview(original, incoming).map((entry) => entry.status),
    ["existing", "new"]);
  assert.throws(() => applyCatalogImport(original, incoming), /Scegli/);
  assert.equal(original[0].name, "Mario");
  const kept = applyCatalogImport(original, incoming, "keep");
  assert.equal(kept.catalog[0].name, "Mario");
  assert.equal(kept.catalog[1].name, "Luigi");
  assert.deepEqual([kept.added, kept.replaced, kept.kept], [1, 0, 1]);
  const replaced = applyCatalogImport(original, incoming, "replace");
  assert.equal(replaced.catalog[0].name, "Mario Updated");
  assert.deepEqual([replaced.added, replaced.replaced, replaced.kept], [1, 1, 0]);
  assert.equal(original[0].name, "Mario");
});

test("multiple catalog actors copy into plan with new IDs and remain independent", () => {
  const state = createState();
  state.settings.defaultReady = 555;
  state.actorCatalog = parseCatalogRows(rows);
  const [mario, luigi] = addCatalogActorsToPlan(state, ["cast-001", "cast-002"]);
  assert.equal(mario.catalogId, "cast-001");
  assert.notEqual(mario.id, mario.catalogId);
  assert.notEqual(mario.id, luigi.id);
  assert.deepEqual(state.actors.map((actor) => actor.ready), [555, 555]);
  assert.deepEqual(mario.tasks.map((task) => task.duration), [20, 15, 10]);
  assert.throws(() => addCatalogActorsToPlan(state, ["cast-001"]), /già nel piano/);
  mario.name = "Plan edit";
  mario.tasks[0].duration = 50;
  state.actorCatalog = applyCatalogImport(state.actorCatalog,
    parseCatalogRows([{ ...rows[0], Nome: "Catalog update", DurataTrucco: 30 }]),
    "replace").catalog;
  assert.equal(mario.name, "Plan edit");
  assert.equal(mario.tasks[0].duration, 50);
  assert.equal(state.actorCatalog[0].name, "Catalog update");
  const version = saveSchedule(state, "Piano");
  assert.equal(version.plan.actorCatalog, undefined);
  assert.equal(openSchedule(state, version.id).actorCatalog[0].name, "Catalog update");
  assert.deepEqual(parseRows(serializeRows(state)), state);
});

test("older project metadata receives an empty catalog", () => {
  const state = createState();
  const rows = serializeRows(state);
  rows.FlashSCHM[0].Version = 4;
  const metadata = JSON.parse(rows.FlashSCHM[0].Data);
  delete metadata.actorCatalog;
  rows.FlashSCHM[0].Data = JSON.stringify(metadata);
  assert.deepEqual(parseRows(rows).actorCatalog, []);
});
