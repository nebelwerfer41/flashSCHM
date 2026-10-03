import {
  createState,
  createActor,
  newId,
  DEPARTMENTS,
  LABELS,
  DEFAULT_READY,
} from "./state.js";
import { generateSchedule } from "./scheduling/scheduler.js";
import { detectConflicts } from "./scheduling/conflicts.js";
import { createTimeline } from "./timeline/timeline.js";
import { readWorkbook, writeWorkbook } from "./io/xlsx.js";
import { parseTime, formatTime } from "./utils/time.js";
import { saveSchedule, openSchedule, deleteSchedule } from "./versions.js";
import {
  readCatalogWorkbook, writeCatalogWorkbook, catalogImportPreview,
  applyCatalogImport, addCatalogActorsToPlan,
} from "./catalog.js";
import {
  renderActors,
  renderProfessionals,
  renderTable,
  renderDiagnostics,
} from "./ui/render.js";
import { renderRuleEditor } from "./ui/rules.js";
import { button, el } from "./ui/dom.js";

export function initApp() {
  let state = createState(),
    stale = false,
    exportPending = true;
  let pendingCatalog = null;
  const selectedCatalogIds = new Set();
  const $ = (id) => document.getElementById(id);
  let timeline = { render() {} };
  const catalogDurations = (entry) =>
    DEPARTMENTS.map((type) => `${LABELS[type]} ${entry.durations[type]} min`).join(" · ");
  function renderCatalogSelection() {
    $("addCatalogActors").disabled = selectedCatalogIds.size === 0;
    $("addCatalogActors").textContent = selectedCatalogIds.size
      ? `Aggiungi ${selectedCatalogIds.size} al piano`
      : "Aggiungi selezionati al piano";
  }
  function renderCatalog() {
    const query = $("catalogSearch").value.trim().toLocaleLowerCase("it-IT");
    const inPlan = new Set(state.actors.map((actor) => actor.catalogId));
    for (const id of selectedCatalogIds)
      if (!state.actorCatalog.some((entry) => entry.id === id) || inPlan.has(id))
        selectedCatalogIds.delete(id);
    const visible = state.actorCatalog.filter((entry) =>
      `${entry.name} ${entry.id}`.toLocaleLowerCase("it-IT").includes(query));
    $("catalogCount").textContent = String(state.actorCatalog.length);
    $("catalogList").replaceChildren(...visible.map((entry) => {
      const checkbox = el("input", {
        type: "checkbox",
        checked: selectedCatalogIds.has(entry.id),
        disabled: inPlan.has(entry.id),
        "aria-label": `Seleziona ${entry.name}`,
      });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) selectedCatalogIds.add(entry.id);
        else selectedCatalogIds.delete(entry.id);
        renderCatalogSelection();
      });
      return el("li", {},
        el("label", { className: "catalog-choice" }, checkbox,
          el("span", {}, el("strong", { text: entry.name }),
            el("small", { text: `${entry.id} · ${catalogDurations(entry)}${inPlan.has(entry.id) ? " · Già nel piano" : ""}` })),
        ),
      );
    }));
    $("catalogEmpty").hidden = visible.length > 0;
    $("catalogEmpty").textContent = state.actorCatalog.length
      ? "Nessun attore corrisponde alla ricerca."
      : "Il catalogo è vuoto. Esporta un modello XLSX, compilalo e reimportalo.";
    renderCatalogSelection();
  }
  function renderCatalogPreview() {
    $("catalogPreview").hidden = !pendingCatalog;
    if (!pendingCatalog) return;
    const preview = catalogImportPreview(state.actorCatalog, pendingCatalog);
    const duplicates = preview.filter((entry) => entry.status === "existing").length;
    $("catalogPreviewStatus").textContent =
      `${preview.length} schede nel file: ${preview.length - duplicates} nuove, ${duplicates} con ID già presente.`;
    $("catalogPreviewRows").replaceChildren(...preview.map((entry) => {
      const existing = state.actorCatalog.find((item) => item.id === entry.id);
      return el("li", {},
        el("strong", { text: entry.name }),
        el("small", { text: `${entry.id} · ${catalogDurations(entry)} · ${entry.status === "existing" ? "ID già presente" : "Nuovo"}` }),
        ...(existing ? [el("small", {
          text: `Nel catalogo: ${existing.name} · ${catalogDurations(existing)}`,
        })] : []),
      );
    }));
    $("duplicateActionLabel").hidden = duplicates === 0;
    $("applyCatalogImport").disabled = !preview.length ||
      (duplicates > 0 && !$("duplicateAction").value);
  }
  function renderExportStatus() {
    $("exportStatus").textContent = exportPending
      ? "Modifiche non ancora esportate. Esporta l’XLSX prima di chiudere."
      : "Progetto esportato. Nessuna modifica da esportare.";
    $("exportStatus").setAttribute("data-pending", String(exportPending));
  }
  function markDirty() {
    exportPending = true;
    renderExportStatus();
  }
  function renderVersions() {
    $("savedSchedules").replaceChildren(
      ...state.savedSchedules.map((version) =>
        el("li", {},
          el("div", { className: "version-details" },
            el("strong", { text: version.name }),
            el("small", { text: new Date(version.savedAt).toLocaleString("it-IT") }),
          ),
          button("Apri", () => {
            state = openSchedule(state, version.id);
            stale = false;
            markDirty();
            renderConfiguration();
            renderCatalog();
            renderSchedule(true);
            $("versionStatus").textContent = `Versione “${version.name}” aperta come piano modificabile.`;
          }),
          button("Elimina", () => {
            deleteSchedule(state, version.id);
            markDirty();
            renderVersions();
            $("versionStatus").textContent = `Versione “${version.name}” eliminata.`;
          }),
        ),
      ),
    );
    $("versionsEmpty").hidden = state.savedSchedules.length > 0;
  }
  function renderSchedule(fit = false) {
    renderTable($("scheduleTableBody"), state, {
      showEnd: $("showStartEndCheckbox").checked,
      showProfessional: $("showProfessionalCheckbox").checked,
    });
    renderDiagnostics(
      $("diagnostics"),
      state,
      detectConflicts(state.actors, state.rules),
      stale,
    );
    timeline.render(fit);
  }
  function changed() {
    markDirty();
    stale = state.actors.some((a) => a.schedule.length > 0);
    state.diagnostics = [];
    renderSchedule();
  }
  function renderDefaultReady() {
    $("defaultReady").value = formatTime(
      state.settings.defaultReady ?? DEFAULT_READY,
    );
    $("defaultReady").setCustomValidity("");
    $("defaultReady").setAttribute("aria-invalid", "false");
    $("readyStatus").textContent = "";
  }
  function readDefaultReady() {
    try {
      const ready = parseTime($("defaultReady").value);
      if (state.settings.defaultReady !== ready) markDirty();
      state.settings.defaultReady = ready;
      $("defaultReady").setCustomValidity("");
      $("defaultReady").setAttribute("aria-invalid", "false");
      return ready;
    } catch {
      $("defaultReady").setCustomValidity("Inserisci un orario READY valido.");
      $("defaultReady").setAttribute("aria-invalid", "true");
      $("defaultReady").reportValidity();
      return null;
    }
  }
  function renderConfiguration() {
    renderDefaultReady();
    renderProfessionals(
      $("professionalSettings"),
      state,
      changed,
      renderConfiguration,
    );
    for (const [index, type] of DEPARTMENTS.entries())
      $("professionalSettings").children[index].append(
        button(`Aggiungi ${LABELS[type]}`, () => {
          state.professionals[type].push({
            id: newId(),
            name: `${LABELS[type]} ${state.professionals[type].length + 1}`,
          });
          changed();
          renderConfiguration();
        }),
      );
    renderRuleEditor($("globalRules"), state, null, () => {
      changed();
      renderActorRows();
    });
    renderActorRows();
  }
  function renderActorRows() {
    $("actorCount").textContent = String(state.actors.length);
    renderActors($("actorRows"), state, changed, (id) => {
      state.actors = state.actors.filter((a) => a.id !== id);
      changed();
      renderActorRows();
      renderCatalog();
    });
  }
  $("defaultReady").addEventListener("change", () => {
    if (readDefaultReady() !== null)
      $("readyStatus").textContent = "Predefinito aggiornato. Gli attori esistenti mantengono il loro READY.";
  });
  $("applyDefaultReady").addEventListener("click", () => {
    const ready = readDefaultReady();
    if (ready === null) return;
    const updated = state.actors.filter((actor) => actor.ready !== ready).length;
    for (const actor of state.actors) actor.ready = ready;
    if (updated) {
      changed();
      renderActorRows();
    }
    $("readyStatus").textContent = `READY ${formatTime(ready)} applicato a ${state.actors.length} attori.`;
  });
  $("addActor").addEventListener("click", () => {
    const ready = readDefaultReady();
    if (ready === null) return;
    state.actors.push(createActor({ ready }));
    changed();
    renderActorRows();
    $("actorRows").lastElementChild?.querySelector("input")?.focus();
  });
  $("catalogSearch").addEventListener("input", renderCatalog);
  $("duplicateAction").addEventListener("change", renderCatalogPreview);
  $("catalogImportInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (!globalThis.XLSX)
        throw new Error("Libreria XLS non disponibile. Verifica la connessione.");
      pendingCatalog = readCatalogWorkbook(globalThis.XLSX, await file.arrayBuffer());
      $("duplicateAction").value = "";
      renderCatalogPreview();
      $("catalogStatus").textContent = "Controlla l’anteprima e applica l’importazione.";
    } catch (error) {
      pendingCatalog = null;
      renderCatalogPreview();
      $("catalogStatus").textContent = `Importazione catalogo non riuscita: ${error.message}`;
    }
    event.target.value = "";
  });
  $("applyCatalogImport").addEventListener("click", () => {
    if (!pendingCatalog) return;
    try {
      const result = applyCatalogImport(
        state.actorCatalog, pendingCatalog, $("duplicateAction").value);
      state.actorCatalog = result.catalog;
      pendingCatalog = null;
      selectedCatalogIds.clear();
      renderCatalogPreview();
      renderCatalog();
      markDirty();
      $("catalogStatus").textContent =
        `Catalogo aggiornato: ${result.added} nuove, ${result.replaced} aggiornate, ${result.kept} mantenute. Esporta il catalogo XLSX per conservarlo.`;
    } catch (error) {
      $("catalogStatus").textContent = error.message;
    }
  });
  $("cancelCatalogImport").addEventListener("click", () => {
    pendingCatalog = null;
    renderCatalogPreview();
    $("catalogStatus").textContent = "Importazione catalogo annullata.";
  });
  $("catalogExport").addEventListener("click", () => {
    try {
      if (!globalThis.XLSX)
        throw new Error("Libreria XLS non disponibile. Verifica la connessione.");
      globalThis.XLSX.writeFile(
        writeCatalogWorkbook(globalThis.XLSX, state.actorCatalog),
        "flash_schm_catalogo_attori.xlsx",
      );
      $("catalogStatus").textContent = "Catalogo XLSX esportato.";
    } catch (error) {
      $("catalogStatus").textContent = `Esportazione catalogo non riuscita: ${error.message}`;
    }
  });
  $("addCatalogActors").addEventListener("click", () => {
    try {
      if (readDefaultReady() === null) return;
      const count = addCatalogActorsToPlan(state, Array.from(selectedCatalogIds)).length;
      selectedCatalogIds.clear();
      changed();
      renderActorRows();
      renderCatalog();
      $("catalogStatus").textContent = `${count} attori aggiunti al piano con il READY predefinito.`;
    } catch (error) {
      $("catalogStatus").textContent = error.message;
    }
  });
  $("generate").addEventListener("click", () => {
    if (
      [...document.querySelectorAll("input")].some(
        (input) => !input.reportValidity(),
      )
    )
      return;
    const result = generateSchedule(state);
    // Preserve actor input order; scheduling priority is an explicit separate ordering.
    for (const actor of state.actors) {
      const scheduled = result.actors.find((a) => a.id === actor.id);
      actor.schedule = scheduled.schedule;
      actor.arrival = scheduled.arrival;
    }
    state.diagnostics = result.diagnostics;
    stale = false;
    markDirty();
    renderSchedule(true);
  });
  $("saveSchedule").addEventListener("click", () => {
    try {
      const version = saveSchedule(state, $("versionName").value);
      $("versionName").value = "";
      markDirty();
      renderVersions();
      $("versionStatus").textContent = `Versione “${version.name}” salvata nel progetto. Esporta l’XLSX per conservarla.`;
    } catch (error) {
      $("versionStatus").textContent = error.message;
    }
  });
  for (const id of ["showStartEndCheckbox", "showProfessionalCheckbox"])
    $(id).addEventListener("change", () => renderSchedule());
  $("export").addEventListener("click", () => {
    try {
      if (!globalThis.XLSX)
        throw new Error(
          "Libreria XLS non disponibile. Verifica la connessione.",
        );
      globalThis.XLSX.writeFile(
        writeWorkbook(globalThis.XLSX, state),
        "flash_scheduler_export.xlsx",
        { cellStyles: true },
      );
      exportPending = false;
      renderExportStatus();
      $("ioStatus").setAttribute("data-status", "success");
      $("ioStatus").textContent = "Esportazione completata.";
    } catch (error) {
      $("ioStatus").setAttribute("data-status", "error");
      $("ioStatus").textContent = `Esportazione non riuscita: ${error.message}`;
    }
  });
  $("xlsImportInput").addEventListener("change", async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      if (!globalThis.XLSX)
        throw new Error(
          "Libreria XLS non disponibile. Verifica la connessione.",
        );
      const imported = readWorkbook(globalThis.XLSX, await file.arrayBuffer());
      state = imported;
      state.diagnostics ||= [];
      stale = false;
      exportPending = false;
      renderConfiguration();
      renderVersions();
      selectedCatalogIds.clear();
      pendingCatalog = null;
      renderCatalogPreview();
      renderCatalog();
      renderExportStatus();
      renderSchedule(true);
      $("ioStatus").setAttribute("data-status", "success");
      $("ioStatus").textContent = "Importazione completata. Se hai modificato gli orari, genera di nuovo la programmazione.";
    } catch (error) {
      $("ioStatus").setAttribute("data-status", "error");
      $("ioStatus").textContent = `Importazione non riuscita: ${error.message}`;
    }
    event.target.value = "";
  });
  renderConfiguration();
  renderVersions();
  renderCatalog();
  renderCatalogPreview();
  renderExportStatus();
  try {
    timeline = createTimeline(
      $("visualization"), globalThis.vis, () => state, () => {
        markDirty();
        renderSchedule();
      },
    );
  } catch (error) {
    $("visualization").textContent = "Timeline non disponibile. Puoi continuare a usare la tabella di programmazione.";
    console.error("Timeline initialization failed", error);
  }
  renderSchedule();
  return { getState: () => state, destroy: () => timeline.destroy?.() };
}
initApp();
