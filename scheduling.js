// scheduling.js

// Inizializza la disponibilità dei professionisti
function initializeProfessionals() {
    professionals = { trucco: [], capelli: [], costumi: [] };
    Object.keys(professionals).forEach(key => {
        professionals[key] = [];
        for (let i = 0; i < professionalSettings[key].count; i++) {
            professionals[key].push([]);
        }
    });
}

// Genera la programmazione degli attori
function generateSchedule() {
    console.log("Inizio generazione della programmazione...");
    const rows = document.querySelectorAll("#actorRows .input-row");
    let hasValidationError = false;
    const newActors = [];

    rows.forEach(row => {
        row.classList.remove('error');
        const existingError = row.querySelector('.error-message');
        if (existingError) {
            existingError.remove();
        }

        const inputs = row.querySelectorAll("input");
        const actorName = inputs[0].value.trim();
        const readyTime = inputs[1].value;

        if (!actorName || !readyTime) {
            hasValidationError = true;
            row.classList.add('error');
            const errorMessage = document.createElement('span');
            errorMessage.classList.add('error-message');
            errorMessage.textContent = 'Compila nome attore e orario di pronti.';
            row.appendChild(errorMessage);
            return;
        }

        const actor = {
            name: actorName,
            readyTime,
            tasks: [],
            schedule: [],
            scheduleInfo: {},
            arrivalTime: '',
            // Converte i selettori in numeri interi (o null se non selezionato)
            makeupProfessional: row.querySelector('.makeup-artist-select').value
                ? parseInt(row.querySelector('.makeup-artist-select').value)
                : null,
            hairProfessional: row.querySelector('.hairdresser-select').value
                ? parseInt(row.querySelector('.hairdresser-select').value)
                : null,
        };

        // Durate dei task (trucco, capelli, costumi)
        const makeupDuration = parseInt(inputs[2].value, 10) || 0;
        const hairDuration = parseInt(inputs[3].value, 10) || 0;
        const costumeDuration = parseInt(inputs[4].value, 10) || 0;

        if (makeupDuration > 0) {
            actor.tasks.push({ type: 'trucco', duration: makeupDuration, actorName: actor.name });
        }
        if (hairDuration > 0) {
            actor.tasks.push({ type: 'capelli', duration: hairDuration, actorName: actor.name });
        }
        if (costumeDuration > 0) {
            actor.tasks.push({ type: 'costumi', duration: costumeDuration, actorName: actor.name });
        }

        console.log(`Attore aggiunto: ${actor.name}`, actor.tasks);
        newActors.push(actor);
    });

    if (hasValidationError) {
        console.warn('Validazione fallita. Correggere gli errori prima di generare la programmazione.');
        return;
    }

    const scheduleTableBody = document.getElementById("scheduleTableBody");
    scheduleTableBody.innerHTML = ""; // Pulisce la tabella di schedulazione

    actors.length = 0; // Resetta gli attori
    newActors.forEach(actor => actors.push(actor));

    // Ordina gli attori in base all'orario di pronti
    actors.sort((a, b) => a.readyTime.localeCompare(b.readyTime));
    initializeProfessionals(); // Inizializza i professionisti per reparto

    // Procedura di schedulazione
    for (const actor of actors) {
        let scheduled = false;
        let attempt = 0;
        const maxAttempts = 48;

        while (!scheduled && attempt <= maxAttempts) {
            const totalTaskDuration = actor.tasks.reduce((sum, task) => sum + task.duration, 0);
            const additionalTime = attempt * 5;
            actor.arrivalTime = subtractMinutes(actor.readyTime, totalTaskDuration + additionalTime);
            actor.arrivalTime = roundTimeToNearest5(actor.arrivalTime);
            scheduled = trySchedulingActor(actor);

            if (!scheduled) {
                console.log(`Tentativo fallito per ${actor.name} al tentativo ${attempt}.`);
                attempt++;
            }
        }

        if (!scheduled) {
            console.error(`Impossibile programmare ${actor.name} entro l'orario di pronti.`);
            continue;
        }

        console.log(`Attore schedulato: ${actor.name}`, actor.schedule);
        addActorToScheduleTable(actor);
    }

    updateTimeline();
}



// Funzione per tentare di schedulare un attore
function trySchedulingActor(actor) {
    const permutations = generateTaskPermutations(actor.tasks);

    for (const taskOrder of permutations) {
        let tempProfessionals = JSON.parse(JSON.stringify(professionals));

        actor.schedule = [];
        actor.scheduleInfo = {};

        // Tentativo di schedulare i task dell'attore con l'ordine corrente
        const success = scheduleActorTasks(actor, taskOrder, tempProfessionals);

        if (success) {
            professionals = tempProfessionals;
            return true; // Schedulazione riuscita
        } else {
            // Se fallisce, prova a modificare l'arrivo per anticipare
            console.log(`Schedulazione fallita per ordine:`, taskOrder);
        }
    }

    return false; // Nessuna schedulazione possibile con l'arrivo corrente
}


// Funzione per schedulare i task di un attore con un dato ordine
function scheduleActorTasks(actor, taskOrder, tempProfessionals) {
    let currentTime = actor.arrivalTime;

    for (const task of taskOrder) {
        const taskDuration = task.duration;

        // Recupera il professionista preferito (se presente)
        const preferredProfessional = task.type === 'trucco'
            ? actor.makeupProfessional
            : task.type === 'capelli'
            ? actor.hairProfessional
            : null;

        let earliestStartTime = findEarliestStartTimeForTask(task, currentTime, actor.readyTime, tempProfessionals, preferredProfessional);

        // Se il professionista preferito non è disponibile, anticipa
        while (!earliestStartTime && isTimeBeforeOrEqual(currentTime, actor.readyTime)) {
            currentTime = subtractMinutes(currentTime, 5); // Anticipa di 5 minuti
            earliestStartTime = findEarliestStartTimeForTask(task, currentTime, actor.readyTime, tempProfessionals, preferredProfessional);
        }

        if (!earliestStartTime) {
            return false; // Task non schedulabile con l'arrivo corrente
        }

        const taskEndTime = addMinutes(earliestStartTime, taskDuration);

        // Verifica che il task non si sovrapponga con altri task dell'attore
        const hasOverlap = actor.schedule.some(existingTask => {
            return !(isTimeBeforeOrEqual(existingTask.endTime, earliestStartTime) || isTimeBeforeOrEqual(taskEndTime, existingTask.startTime));
        });

        if (hasOverlap) {
            console.warn(`Sovrapposizione trovata per ${actor.name} - Task: ${task.type}`);
            return false; // Task non schedulabile a causa della sovrapposizione
        }

        currentTime = taskEndTime;

        if (professionalSettings[task.type].count > 0) {
            const assignedProfessionalIndex = assignTaskToProfessional(task, earliestStartTime, taskEndTime, tempProfessionals, preferredProfessional);
            task.professionalIndex = assignedProfessionalIndex; // Assegna il professionista
        }

        actor.schedule.push({
            startTime: earliestStartTime,
            endTime: taskEndTime,
            type: task.type,
            actorName: actor.name,
            professionalIndex: task.professionalIndex
        });
        actor.scheduleInfo[task.type] = earliestStartTime;
    }

    return true; // Schedulazione completata
}




function findEarliestStartTimeForTask(task, startTime, readyTime, tempProfessionals, preferredProfessional = null) {
    let earliestStartTime = startTime;

    while (isTimeBeforeOrEqual(earliestStartTime, readyTime)) {
        const taskEndTime = addMinutes(earliestStartTime, task.duration);

        if (isTimeBeforeOrEqual(taskEndTime, readyTime)) {
            if (professionalSettings[task.type].count > 0) {
                const isAvailable = isProfessionalAvailable(task, earliestStartTime, taskEndTime, tempProfessionals, preferredProfessional);
                if (isAvailable) {
                    return earliestStartTime;
                }
            } else {
                return earliestStartTime; // Task senza professionisti specifici
            }
        }
        earliestStartTime = subtractMinutes(earliestStartTime, 5); // Anticipa di 5 minuti
    }

    return null; // Nessun orario disponibile
}


function findNextAvailableTimeForProfessional(task, currentStartTime, readyTime, tempProfessionals) {
    const professionalsOfType = tempProfessionals[task.type];
    let nextAvailableTime = null;

    professionalsOfType.forEach((professionalSchedule, index) => {
        for (let i = 0; i <= professionalSchedule.length; i++) {
            const prevSlotEnd = i === 0 ? currentStartTime : professionalSchedule[i - 1].endTime;
            const nextSlotStart = i === professionalSchedule.length ? readyTime : professionalSchedule[i].startTime;

            const slotStart = maxTime(currentStartTime, prevSlotEnd);
            const potentialEndTime = addMinutes(slotStart, task.duration);

            if (isTimeBeforeOrEqual(potentialEndTime, nextSlotStart) && isTimeBeforeOrEqual(potentialEndTime, readyTime)) {
                nextAvailableTime = slotStart;
                task.professionalIndex = index;
                return;
            }
        }
    });

    return nextAvailableTime;
}

function isProfessionalAvailable(task, startTime, endTime, tempProfessionals, preferredProfessional = null) {
    const professionalsOfType = tempProfessionals[task.type];

    if (preferredProfessional !== null) {
        // Controlla solo il professionista preferito
        const professionalSchedule = professionalsOfType[preferredProfessional];
        const isAvailable = professionalSchedule.every(slot => {
            return isTimeBeforeOrEqual(slot.endTime, startTime) || isTimeBeforeOrEqual(endTime, slot.startTime);
        });

        if (isAvailable) {
            task.professionalIndex = preferredProfessional;
            return true;
        }
        return false;
    }

    // Controlla tutti i professionisti disponibili
    for (let i = 0; i < professionalsOfType.length; i++) {
        const professionalSchedule = professionalsOfType[i];
        const isAvailable = professionalSchedule.every(slot => {
            return isTimeBeforeOrEqual(slot.endTime, startTime) || isTimeBeforeOrEqual(endTime, slot.startTime);
        });

        if (isAvailable) {
            task.professionalIndex = i;
            return true;
        }
    }
    return false;
}


function assignTaskToProfessional(task, startTime, endTime, tempProfessionals, preferredProfessional = null) {
    const professionalsOfType = tempProfessionals[task.type];

    // Se c'è un professionista preferito
    if (preferredProfessional !== null && professionalsOfType[preferredProfessional]) {
        const professionalSchedule = professionalsOfType[preferredProfessional];
        const isAvailable = professionalSchedule.every(slot => {
            return isTimeBeforeOrEqual(slot.endTime, startTime) || isTimeBeforeOrEqual(endTime, slot.startTime);
        });

        if (isAvailable) {
            professionalSchedule.push({ startTime, endTime, actorName: task.actorName });
            professionalSchedule.sort((a, b) => a.startTime.localeCompare(b.startTime));
            console.log(`Task assegnato al professionista preferito (${preferredProfessional}):`, task);
            return preferredProfessional;
        } else {
            console.warn(`Professionista preferito (${preferredProfessional}) non disponibile per il task:`, task);
            return null;
        }
    }

    // Se nessun professionista è preferito, assegna al primo disponibile
    for (let i = 0; i < professionalsOfType.length; i++) {
        const professionalSchedule = professionalsOfType[i];
        const isAvailable = professionalSchedule.every(slot => {
            return isTimeBeforeOrEqual(slot.endTime, startTime) || isTimeBeforeOrEqual(endTime, slot.startTime);
        });

        if (isAvailable) {
            professionalSchedule.push({ startTime, endTime, actorName: task.actorName });
            professionalSchedule.sort((a, b) => a.startTime.localeCompare(b.startTime));
            console.log(`Task assegnato al professionista ${i}:`, task);
            return i;
        }
    }

    console.warn(`Nessun professionista disponibile per il task:`, task);
    return null;
}



function generateTaskPermutations(tasks) {
    if (tasks.length <= 1) return [tasks];
    const permutations = [];
    for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        const remainingTasks = tasks.slice(0, i).concat(tasks.slice(i + 1));
        const remainingPermutations = generateTaskPermutations(remainingTasks);
        for (const permutation of remainingPermutations) {
            permutations.push([task].concat(permutation));
        }
    }
    return permutations;
}
