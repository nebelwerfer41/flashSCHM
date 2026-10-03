import {
  createState,
  createActor,
  newId,
  DEPARTMENTS,
  LABELS,
} from "./state.js";
import { generateSchedule } from "./scheduling/scheduler.js";
import { detectConflicts } from "./scheduling/conflicts.js";
import { createTimeline } from "./timeline/timeline.js";
import { readWorkbook, writeWorkbook } from "./io/xlsx.js";
import {
  renderActors,
  renderProfessionals,
  renderTable,
  renderDiagnostics,
} from "./ui/render.js";
import { renderRuleEditor } from "./ui/rules.js";
import { button } from "./ui/dom.js";

export function initApp() {
  let state = createState(),
    stale = false;
  const $ = (id) => document.getElementById(id);
  let timeline = { render() {} };
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
    stale = state.actors.some((a) => a.schedule.length > 0);
    state.diagnostics = [];
    renderSchedule();
  }
  function renderConfiguration() {
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
  $("addActor").addEventListener("click", () => {
    state.actors.push(createActor());
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
    renderSchedule(true);
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
      renderConfiguration();
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
  try {
    timeline = createTimeline(
      $("visualization"), globalThis.vis, () => state, () => renderSchedule(),
    );
  } catch (error) {
    $("visualization").textContent = "Timeline non disponibile. Puoi continuare a usare la tabella di programmazione.";
    console.error("Timeline initialization failed", error);
  }
  renderSchedule();
  return { getState: () => state, destroy: () => timeline.destroy?.() };
}
initApp();
