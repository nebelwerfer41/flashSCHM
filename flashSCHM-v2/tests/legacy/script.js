// script.js

const actors = [];  // Lista degli attori
let professionals = { trucco: [], capelli: [], costumi: [] };  // Schedule dei professionisti
const professionalSettings = {  // Numero di professionisti per reparto
    trucco: { count: 1 },
    capelli: { count: 1 },
    costumi: { count: 0 }
};
const departmentPriority = {
    trucco: 1,
    capelli: 2,
    costumi: 3
};

let pixelsPerMinute = 5; // Scaling factor for zooming

const professionalNames = { trucco: [], capelli: [] };

// Aggiorna configurazione professionisti
function updateProfessionalSettings() {
    console.log("Inizio aggiornamento configurazione professionisti...");

    Object.keys(professionalSettings).forEach(key => {
        const countInput = document.getElementById(`${key}-count`);
        professionalSettings[key].count = parseInt(countInput.value);
        console.log(`Impostazione per ${key}: numero di professionisti = ${professionalSettings[key].count}`);

        if (key !== 'costumi') {
            const nameInput = document.getElementById(`${key}-names`);
            let names = nameInput.value.split(',').map(name => name.trim()).filter(name => name);

            // Genera nomi predefiniti se non sufficienti
            while (names.length < professionalSettings[key].count) {
                names.push(`${key.charAt(0).toUpperCase()} ${names.length + 1}`);
            }
            console.log(`Nomi finali (dopo aggiunta predefiniti) per ${key}:`, names);

            // Troncamento al numero massimo di professionisti
            professionalNames[key] = names.slice(0, professionalSettings[key].count);
            console.log(`Nomi troncati a ${professionalSettings[key].count} per ${key}:`, professionalNames[key]);
        }
    });
    updateDepartmentPriorityFromInputs();

    initializeProfessionals();
    populateProfessionalOptionsForAll();
    console.log("Configurazione aggiornata con successo:", professionalSettings, professionalNames);

    // Aggiorna la timeline con i nuovi gruppi
    updateTimeline();

    alert("Configurazione aggiornata!");
}

updateProfessionalSettings()

// Popola opzioni dei selettori
function populateProfessionalOptions(selectElement, department) {
    console.log(`Popolamento selettore per ${department}...`);
    console.log(`Nomi disponibili per ${department}:`, professionalNames[department]);

    // Rimuove tutte le opzioni esistenti tranne la prima ("Qualsiasi")
    while (selectElement.children.length > 1) {
        selectElement.removeChild(selectElement.lastChild);
    }

    // Aggiunge i professionisti attivi al selettore
    professionalNames[department].forEach((name, index) => {
        const option = document.createElement('option');
        option.value = index; // L'indice rappresenta il professionista
        option.textContent = name || `${department.charAt(0).toUpperCase()} ${index + 1}`;
        selectElement.appendChild(option);
        console.log(`Aggiunto al selettore: ${name}`);
    });

    console.log(`Popolamento completato per ${department}.`);
}

function populateProfessionalOptionsForAll() {
    console.log("Popolamento di tutti i selettori degli attori...");

    document.querySelectorAll('.makeup-artist-select').forEach(select => {
        console.log("Popolamento selettore trucco...");
        populateProfessionalOptions(select, 'trucco');
    });

    document.querySelectorAll('.hairdresser-select').forEach(select => {
        console.log("Popolamento selettore capelli...");
        populateProfessionalOptions(select, 'capelli');
    });

    console.log("Popolamento selettori completato.");
}


// Funzione per aggiungere una riga per un attore
function addActorRow(data = {}) {
    const container = document.getElementById("actorRows");
    const row = document.createElement("div");
    row.classList.add("input-row");

    row.innerHTML = `
        <input type="text" placeholder="Nome Attore" value="${data.name || ''}" />
        <input type="time" placeholder="Orario di Pronti" value="${data.readyTime || ''}" />
        <input type="number" placeholder="Priorità Attore" value="${data.priority ?? 1}" min="1" />
        <input type="number" placeholder="Durata Trucco (min)" value="${data.makeupDuration || ''}" min="0" />
        <select class="makeup-artist-select">
            <option value="">Qualsiasi</option>
            ${professionalNames.trucco.map((name, index) => `<option value="${index}">${name}</option>`).join('')}
        </select>
        <input type="number" placeholder="Durata Capelli (min)" value="${data.hairDuration || ''}" min="0" />
        <select class="hairdresser-select">
            <option value="">Qualsiasi</option>
            ${professionalNames.capelli.map((name, index) => `<option value="${index}">${name}</option>`).join('')}
        </select>
        <input type="number" placeholder="Durata Costumi (min)" value="${data.costumeDuration || ''}" min="0" />

        <button onclick="removeActorRow(this)">Rimuovi</button>
    `;

    container.appendChild(row);

    // Popola dinamicamente i selettori
    populateProfessionalOptions(row.querySelector('.makeup-artist-select'), 'trucco');
    populateProfessionalOptions(row.querySelector('.hairdresser-select'), 'capelli');
}


// Funzione per rimuovere una riga di attore
function removeActorRow(button) {
    button.parentElement.remove();
}

// Aggiunge un attore alla tabella della programmazione
function addActorToScheduleTable(actor) {
    const row = document.createElement("tr");

    const makeupTask = actor.schedule.find(t => t.type === 'trucco');
    const hairTask = actor.schedule.find(t => t.type === 'capelli');
    const costumeTask = actor.schedule.find(t => t.type === 'costumi');

    const makeupProfessionalName = makeupTask && makeupTask.professionalIndex != null
        ? professionalNames.trucco[makeupTask.professionalIndex]
        : 'Qualsiasi';
    const hairProfessionalName = hairTask && hairTask.professionalIndex != null
        ? professionalNames.capelli[hairTask.professionalIndex]
        : 'Qualsiasi';

    row.innerHTML = `
        <td>${actor.name}</td>
        <td>${actor.arrivalTime || '-'}</td>
        <td>${makeupTask ? `${makeupTask.startTime} - ${makeupTask.endTime} (${makeupProfessionalName})` : '-'}</td>
        <td>${hairTask ? `${hairTask.startTime} - ${hairTask.endTime} (${hairProfessionalName})` : '-'}</td>
        <td>${costumeTask ? `${costumeTask.startTime} - ${costumeTask.endTime}` : '-'}</td>
        <td>${actor.readyTime}</td>
    `;

    const scheduleTableBody = document.getElementById("scheduleTableBody");
    scheduleTableBody.appendChild(row);
}



function updateActorSchedule(actor) {
    const showStartEnd = document.getElementById("showStartEndCheckbox").checked;
    const showProfessional = document.getElementById("showProfessionalCheckbox").checked;

    const rows = document.querySelectorAll("#scheduleTableBody tr");
    rows.forEach(row => {
        const actorNameCell = row.querySelector("td:first-child");
        if (actorNameCell && actorNameCell.textContent.trim() === actor.name) {
            // Trova i task aggiornati
            const makeupTask = actor.schedule.find(t => t.type === 'trucco');
            const hairTask = actor.schedule.find(t => t.type === 'capelli');
            const costumeTask = actor.schedule.find(t => t.type === 'costumi');

            // Recupera il nome del professionista (se richiesto)
            const makeupProfessionalName = makeupTask && makeupTask.professionalIndex != null
                ? professionalNames.trucco[makeupTask.professionalIndex]
                : 'Qualsiasi';
            const hairProfessionalName = hairTask && hairTask.professionalIndex != null
                ? professionalNames.capelli[hairTask.professionalIndex]
                : 'Qualsiasi';

            // Costruisce il contenuto in base ai checkbox
            row.querySelector('td:nth-child(3)').textContent = makeupTask
                ? (showStartEnd ? `${makeupTask.startTime} - ${makeupTask.endTime}` : `${makeupTask.startTime}`) +
                (showProfessional ? ` (${makeupProfessionalName})` : '')
                : '-';
            row.querySelector('td:nth-child(4)').textContent = hairTask
                ? (showStartEnd ? `${hairTask.startTime} - ${hairTask.endTime}` : `${hairTask.startTime}`) +
                (showProfessional ? ` (${hairProfessionalName})` : '')
                : '-';
            row.querySelector('td:nth-child(5)').textContent = costumeTask
                ? (showStartEnd ? `${costumeTask.startTime} - ${costumeTask.endTime}` : `${costumeTask.startTime}`)
                : '-';

            // Aggiorna l'orario di arrivo e l'orario di pronti
            row.querySelector('td:nth-child(2)').textContent = actor.arrivalTime || '-';
            row.querySelector('td:nth-child(6)').textContent = actor.readyTime;

            console.log(`Updated schedule table for ${actor.name}: Arrival Time: ${actor.arrivalTime}`);
        }
    });
}



function updateAllSchedules() {
    actors.forEach(actor => updateActorSchedule(actor));
}

function updateDepartmentPriorityFromInputs() {
    const usedValues = new Set();
    ['trucco', 'capelli', 'costumi'].forEach(dept => {
        const value = parseInt(document.getElementById(`${dept}-priority`).value, 10);
        departmentPriority[dept] = Number.isFinite(value) ? value : 3;
        usedValues.add(departmentPriority[dept]);
    });

    if (usedValues.size < 3) {
        alert('Le priorità dei reparti devono essere univoche (1, 2, 3).');
        let fallback = 1;
        ['trucco', 'capelli', 'costumi'].forEach(dept => {
            departmentPriority[dept] = fallback;
            document.getElementById(`${dept}-priority`).value = fallback;
            fallback++;
        });
    }
}

function actorToExportRow(row) {
    const inputs = row.querySelectorAll('input');
    return {
        Nome: inputs[0].value.trim(),
        OrarioPronti: inputs[1].value,
        PrioritaAttore: parseInt(inputs[2].value, 10) || 1,
        DurataTrucco: parseInt(inputs[3].value, 10) || 0,
        ProfessionistaTrucco: row.querySelector('.makeup-artist-select').value,
        DurataCapelli: parseInt(inputs[4].value, 10) || 0,
        ProfessionistaCapelli: row.querySelector('.hairdresser-select').value,
        DurataCostumi: parseInt(inputs[5].value, 10) || 0
    };
}

function deptToExportRows() {
    return [
        {
            Reparto: 'trucco',
            NumeroProfessionisti: professionalSettings.trucco.count,
            NomiProfessionisti: professionalNames.trucco.join(', '),
            Priorita: departmentPriority.trucco
        },
        {
            Reparto: 'capelli',
            NumeroProfessionisti: professionalSettings.capelli.count,
            NomiProfessionisti: professionalNames.capelli.join(', '),
            Priorita: departmentPriority.capelli
        },
        {
            Reparto: 'costumi',
            NumeroProfessionisti: professionalSettings.costumi.count,
            NomiProfessionisti: '',
            Priorita: departmentPriority.costumi
        }
    ];
}

function exportXls() {
    const actorRows = document.querySelectorAll('#actorRows .input-row');
    const actorData = Array.from(actorRows).map(actorToExportRow);
    const deptData = deptToExportRows();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(actorData), 'Actors');
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(deptData), 'Depts');
    XLSX.writeFile(workbook, 'flash_scheduler_export.xlsx');
}

function importXls(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const workbook = XLSX.read(e.target.result, { type: 'binary' });
        const actorSheet = workbook.Sheets.Actors;
        const deptsSheet = workbook.Sheets.Depts;

        if (deptsSheet) {
            const deptData = XLSX.utils.sheet_to_json(deptsSheet, { defval: '' });
            deptData.forEach(row => {
                const dept = String(row.Reparto || '').toLowerCase();
                if (!professionalSettings[dept]) return;
                const count = parseInt(row.NumeroProfessionisti, 10);
                if (Number.isFinite(count)) {
                    document.getElementById(`${dept}-count`).value = count;
                }
                if (dept !== 'costumi') {
                    document.getElementById(`${dept}-names`).value = row.NomiProfessionisti || '';
                }
                const priority = parseInt(row.Priorita, 10);
                if (Number.isFinite(priority)) {
                    document.getElementById(`${dept}-priority`).value = priority;
                }
            });
            updateProfessionalSettings();
        }

        if (actorSheet) {
            const actorData = XLSX.utils.sheet_to_json(actorSheet, { defval: '' });
            document.getElementById('actorRows').innerHTML = '';
            actorData.forEach(row => {
                addActorRow({
                    name: row.Nome,
                    readyTime: row.OrarioPronti,
                    priority: parseInt(row.PrioritaAttore, 10) || 1,
                    makeupDuration: parseInt(row.DurataTrucco, 10) || 0,
                    hairDuration: parseInt(row.DurataCapelli, 10) || 0,
                    costumeDuration: parseInt(row.DurataCostumi, 10) || 0
                });

                const actorRows = document.querySelectorAll('#actorRows .input-row');
                const lastRow = actorRows[actorRows.length - 1];
                if (row.ProfessionistaTrucco !== '') {
                    lastRow.querySelector('.makeup-artist-select').value = String(row.ProfessionistaTrucco);
                }
                if (row.ProfessionistaCapelli !== '') {
                    lastRow.querySelector('.hairdresser-select').value = String(row.ProfessionistaCapelli);
                }
            });
        }

        event.target.value = '';
        alert('Import XLS completato.');
    };

    reader.readAsBinaryString(file);
}


