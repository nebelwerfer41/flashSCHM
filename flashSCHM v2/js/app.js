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
import { readImportWorkbook, writeWorkbook } from "./io/xlsx.js";
import { parseTime, formatTime } from "./utils/time.js";
import { saveSchedule, openSchedule, deleteSchedule } from "./versions.js";
import {
  catalogImportPreview, applyCatalogImport, addCatalogActorsToPlan,
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
  let pendingImport = null;
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
      : "Il catalogo è vuoto. Compila la scheda Catalogo del progetto XLSX e reimportalo.";
    renderCatalogSelection();
  }
  function renderImportPreview() {
    $("importPreview").hidden = !pendingImport;
    if (!pendingImport) return;
    if (pendingImport.kind === "project") {
      const imported = pendingImport.state;
      $("importPreviewStatus").textContent =
        `Progetto completo: ${imported.actors.length} attori nel piano, ${imported.savedSchedules.length} versioni salvate, ${imported.actorCatalog.length} schede catalogo. Applicare sostituisce il progetto aperto.`;
      $("importPreviewRows").replaceChildren();
      $("duplicateActionLabel").hidden = true;
      $("applyImport").disabled = false;
      $("applyImport").textContent = "Apri progetto";
      return;
    }
    const preview = catalogImportPreview(state.actorCatalog, pendingImport.catalog);
    const duplicates = preview.filter((entry) => entry.status === "existing").length;
    $("importPreviewStatus").textContent =
      `Catalogo precedente: ${preview.length} schede nel file, ${preview.length - duplicates} nuove e ${duplicates} con ID già presente. Il piano e le versioni rimangono nel progetto aperto.`;
    $("importPreviewRows").replaceChildren(...preview.map((entry) => {
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
    $("applyImport").disabled = !preview.length ||
      (duplicates > 0 && !$("duplicateAction").value);
    $("applyImport").textContent = "Importa catalogo";
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
  $("duplicateAction").addEventListener("change", renderImportPreview);
  $("applyImport").addEventListener("click", () => {
    if (!pendingImport) return;
    try {
      if (pendingImport.kind === "project") {
        state = pendingImport.state;
        state.diagnostics ||= [];
        stale = false;
        exportPending = false;
        selectedCatalogIds.clear();
        renderConfiguration();
        renderVersions();
        renderCatalog();
        renderExportStatus();
        renderSchedule(true);
        $("ioStatus").textContent = "Progetto importato: piano, versioni e catalogo disponibili.";
      } else {
        const result = applyCatalogImport(
          state.actorCatalog, pendingImport.catalog, $("duplicateAction").value);
        state.actorCatalog = result.catalog;
        selectedCatalogIds.clear();
        renderCatalog();
        markDirty();
        $("ioStatus").textContent =
          `Catalogo importato: ${result.added} nuove, ${result.replaced} aggiornate, ${result.kept} mantenute. Esporta il progetto XLSX per conservarlo.`;
      }
      pendingImport = null;
      renderImportPreview();
      $("ioStatus").setAttribute("data-status", "success");
    } catch (error) {
      $("ioStatus").setAttribute("data-status", "error");
      $("ioStatus").textContent = `Importazione non riuscita: ${error.message}`;
    }
  });
  $("cancelImport").addEventListener("click", () => {
    pendingImport = null;
    renderImportPreview();
    $("ioStatus").textContent = "Importazione annullata.";
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
        "flash_schm_progetto.xlsx",
        { cellStyles: true },
      );
      exportPending = false;
      renderExportStatus();
      $("ioStatus").setAttribute("data-status", "success");
      $("ioStatus").textContent = "Progetto XLSX esportato con piano, versioni e catalogo.";
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
      pendingImport = readImportWorkbook(globalThis.XLSX, await file.arrayBuffer());
      $("duplicateAction").value = "";
      renderImportPreview();
      $("ioStatus").setAttribute("data-status", "success");
      $("ioStatus").textContent = "File letto. Controlla l’anteprima e applica l’importazione.";
    } catch (error) {
      pendingImport = null;
      renderImportPreview();
      $("ioStatus").setAttribute("data-status", "error");
      $("ioStatus").textContent = `Importazione non riuscita: ${error.message}`;
    }
    event.target.value = "";
  });
  renderConfiguration();
  renderVersions();
  renderCatalog();
  renderImportPreview();
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
