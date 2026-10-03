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
  const $ = (id) => document.getElementById(id);
  let timeline = { render() {} };
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
