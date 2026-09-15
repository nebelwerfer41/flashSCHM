// timelineVis.js

// Initialization of datasets for groups and items
var groups = new vis.DataSet();
var items = new vis.DataSet();
var timeline;

let activeConflicts = {}; // Each actor will have a list of conflicting tasks

// Function to update the timeline with the current data of professionals and actors
function updateTimeline() {
    console.log("Updating timeline...");

    // Clear existing datasets
    groups.clear();
    items.clear();

    let groupValue = 1;

    // Create groups for makeup artists
    if (professionalSettings.trucco.count > 0) {
        professionalNames.trucco.forEach((name, index) => {
            const groupId = `truccatore${index + 1}`;
            groups.add({ id: groupId, content: `${name}`, className: 'trucco', value: groupValue });
            groupValue++;
            console.log(`Group added for Makeup: ${name}`);
        });
    }

    // Create groups for hairdressers
    if (professionalSettings.capelli.count > 0) {
        professionalNames.capelli.forEach((name, index) => {
            const groupId = `parrucchiere${index + 1}`;
            groups.add({ id: groupId, content: `${name}`, className: 'capelli', value: groupValue });
            groupValue++;
            console.log(`Group added for Hair: ${name}`);
        });
    }

    // Group for costumes, which doesn't have subgroups
    groups.add({ id: 'COSTUMI', content: 'Costumes', className: 'costumi', value: groupValue });

    console.log("Updated groups:", groups.get()); // Log to verify updated groups

    // Add items (tasks) for each actor with color classes
    actors.forEach(actor => {
        actor.schedule.forEach(task => {
            let groupId;
            let taskClass;
            if (task.type === 'trucco') {
                groupId = `truccatore${task.professionalIndex + 1}`;
                taskClass = 'trucco';
            } else if (task.type === 'capelli') {
                groupId = `parrucchiere${task.professionalIndex + 1}`;
                taskClass = 'capelli';
            } else {
                groupId = 'COSTUMI';
                taskClass = 'costumi';
            }

            const item = {
                id: actor.name + '-' + task.type,
                group: groupId,
                start: new Date(`2023-01-01T${task.startTime}:00`),
                end: new Date(`2023-01-01T${task.endTime}:00`),
                content: `${actor.name} - ${task.type}`,
                className: taskClass
            };

            items.add(item);
        });
    });

    const { startDate, endDate } = calculateTimelineRange();

    function onMove(item, callback) {
        console.log(`Moved item: ${item.content}, New Start: ${item.start}, New End: ${item.end}, Group: ${item.group}`);

        const actorName = item.content.split(' - ')[0];
        const taskType = item.content.split(' - ')[1].toLowerCase();
        const actor = actors.find(a => a.name === actorName);
        const task = actor.schedule.find(t => t.type === taskType);

        // Format time correctly
        function formatTime(date) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        }

        task.startTime = formatTime(item.start);
        task.endTime = formatTime(item.end);

        // Update the group (professional) based on the new task group
        const groupId = item.group;
        if (groupId.startsWith('truccatore')) {
            task.professionalIndex = parseInt(groupId.replace('truccatore', '')) - 1;
        } else if (groupId.startsWith('parrucchiere')) {
            task.professionalIndex = parseInt(groupId.replace('parrucchiere', '')) - 1;
        } else {
            task.professionalIndex = null; // For costumes or generic tasks
        }

        // Calculate the professional's name (if applicable)
        const professionalName = task.professionalIndex != null
            ? (task.type === 'trucco' ? professionalNames.trucco[task.professionalIndex] : professionalNames.capelli[task.professionalIndex])
            : 'Any';

        console.log(`Updated task: ${taskType}, Professional: ${professionalName}`);

        // Calculate and update the arrival time if necessary
        const newArrivalTime = calculateNewArrivalTime(actor);
        if (newArrivalTime !== actor.arrivalTime) {
            console.log(`Updating arrival time for ${actor.name} from ${actor.arrivalTime} to ${newArrivalTime}`);
            actor.arrivalTime = newArrivalTime;
        }

        // Update the items dataset with the new item before conflict checking
        items.update(item);

        // Check for conflicts
        checkConflicts(item);

        // **Update the item with the new className from the dataset**
        const updatedItem = items.get(item.id);
        item.className = updatedItem.className;

        // Always update the schedule table
        updateActorSchedule(actor);

        // Call the callback with the updated item
        callback(item);
    }


    function onUpdate(item, callback) {
        console.log(`Updated item: ${item.content}, New Start: ${item.start}, New End: ${item.end}`);
    
        const actorName = item.content.split(' - ')[0];
        const taskType = item.content.split(' - ')[1].toLowerCase();
        const actor = actors.find(a => a.name === actorName);
        const task = actor.schedule.find(t => t.type === taskType);
    
        // Format time correctly
        function formatTime(date) {
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
        }
    
        task.startTime = formatTime(item.start);
        task.endTime = formatTime(item.end);
    
        // Calculate and update the arrival time if necessary
        const newArrivalTime = calculateNewArrivalTime(actor);
        if (newArrivalTime <= actor.arrivalTime) {
            console.log(`Updating arrival time for ${actor.name} from ${actor.arrivalTime} to ${newArrivalTime}`);
            actor.arrivalTime = newArrivalTime;
        }
    
        // Update the items dataset with the new item before conflict checking
        items.update(item);
    
        // Check for conflicts
        checkConflicts(item);
    
        // **Update the item with the new className from the dataset**
        const updatedItem = items.get(item.id);
        item.className = updatedItem.className;
    
        // Always update the schedule table
        updateActorSchedule(actor);
    
        // Call the callback with the updated item
        callback(item);
    }
    

    function checkConflicts(item) {
        // Restore colors of resolved conflicting tasks
        Object.keys(activeConflicts).forEach(itemId => {
            const conflictItem = items.get(itemId);
            if (conflictItem) {
                const originalClass = conflictItem.className.replace(' conflict', '');
                items.update({ id: itemId, className: originalClass });
            }
        });

        // Clear activeConflicts
        activeConflicts = {};

        // Get all tasks
        const allItems = items.get();

        // For each task, check for conflicts
        allItems.forEach(item => {
            const overlappingItems = allItems.filter(other =>
                item.id !== other.id &&
                item.start < other.end &&
                item.end > other.start &&
                item.content.split(' - ')[0] === other.content.split(' - ')[0] // Same actor
            );

            if (overlappingItems.length > 0) {
                // Mark the current item as conflicting
                const newClassName = item.className.includes(' conflict') ? item.className : `${item.className} conflict`;
                items.update({ id: item.id, className: newClassName });

                // Add to activeConflicts
                if (!activeConflicts[item.id]) {
                    activeConflicts[item.id] = [];
                }
                activeConflicts[item.id].push(...overlappingItems.map(oi => oi.id));

                // Mark overlapping items as conflicting
                overlappingItems.forEach(overlapItem => {
                    const overlapClassName = overlapItem.className.includes(' conflict') ? overlapItem.className : `${overlapItem.className} conflict`;
                    items.update({ id: overlapItem.id, className: overlapClassName });

                    // Add to activeConflicts
                    if (!activeConflicts[overlapItem.id]) {
                        activeConflicts[overlapItem.id] = [];
                    }
                    activeConflicts[overlapItem.id].push(item.id);
                });
            }
        });

        // Log conflicts
        if (Object.keys(activeConflicts).length > 0) {
            logConflict(`Conflicts detected`, activeConflicts);
        } else {
            logConflict(`No conflicts detected`);
        }
    }

    function logConflict(message, details = null) {
        console.log(`[CONFLICT LOG] ${message}`);
        if (details) {
            console.log(details);
        }
    }

    var options = {
        groupOrder: function (a, b) {
            return a.value - b.value;
        },
        editable: {
            updateTime: true,
            updateGroup: true
        },
        margin: {
            item: 0,
            axis: 0,
            item: {
                horizontal: -25
            }
        },
        start: startDate,
        end: endDate,
        snap: function (date) {
            const milliseconds = 1000 * 60 * 5;
            return Math.round(date / milliseconds) * milliseconds;
        },
        onMove: onMove,
        onUpdate: onUpdate,
        zoomMin: 1000 * 60 * 60,         // one hour in milliseconds
        zoomMax: 1000 * 60 * 60 * 12     // 12h in milliseconds
    };

    if (timeline) {
        timeline.setGroups(groups);
        timeline.setItems(items);
        timeline.setOptions(options);
    } else {
        const container = document.getElementById('visualization');
        timeline = new vis.Timeline(container, items, groups, options);
    }

    // Highlight selected tasks
    timeline.on('select', (properties) => {
        const selectedId = properties.items[0];
        const selectedActor = selectedId?.split('-')[0];

        // Reset all classes to their original class
        items.forEach(item => {
            const originalClass = item.className.replace(' highlight', '');
            items.update({ id: item.id, className: originalClass });
        });

        // Highlight tasks of the selected actor
        if (selectedActor) {
            items.forEach(item => {
                const itemActor = item.content.split(' - ')[0];
                if (itemActor === selectedActor) {
                    items.update({
                        id: item.id,
                        className: `${item.className} highlight`
                    });
                }
            });
        }
    });
}

function calculateNewArrivalTime(actor) {
    // Find the task with the earliest start time among all the actor's tasks
    const earliestTaskStartTime = actor.schedule.reduce((earliest, task) => {
        return isTimeBefore(task.startTime, earliest) ? task.startTime : earliest;
    }, actor.readyTime); // Use `readyTime` as the initial comparison value

    console.log(actor.schedule);
    const roundedArrivalTime = roundTimeToNearest5(earliestTaskStartTime);
    console.log(`Calculated new arrival time for ${actor.name}: ${roundedArrivalTime}`);

    return roundedArrivalTime;
}

// Function to update the entire schedule table
function updateScheduleTable() {
    const scheduleTableBody = document.getElementById("scheduleTableBody");

    if (!scheduleTableBody) {
        console.error("Element scheduleTableBody not found in the DOM.");
        return;
    }

    scheduleTableBody.innerHTML = ""; // Clear the table

    // Regenerate the table using updated data
    actors.forEach(actor => {
        const row = document.createElement("tr");

        // Create cells for each actor's information
        const nameCell = document.createElement("td");
        nameCell.textContent = actor.name;
        row.appendChild(nameCell);

        const arrivalTimeCell = document.createElement("td");
        arrivalTimeCell.textContent = actor.arrivalTime || '-';
        row.appendChild(arrivalTimeCell);

        const truccoTimeCell = document.createElement("td");
        truccoTimeCell.textContent = actor.scheduleInfo.trucco || '-';
        row.appendChild(truccoTimeCell);

        const capelliTimeCell = document.createElement("td");
        capelliTimeCell.textContent = actor.scheduleInfo.capelli || '-';
        row.appendChild(capelliTimeCell);

        const costumiTimeCell = document.createElement("td");
        costumiTimeCell.textContent = actor.scheduleInfo.costumi || '-';
        row.appendChild(costumiTimeCell);

        const readyTimeCell = document.createElement("td");
        readyTimeCell.textContent = actor.readyTime;
        row.appendChild(readyTimeCell);

        // Add the row to the table
        scheduleTableBody.appendChild(row);
    });
    console.log("Table updated with new actor data.");
}

// Function to calculate the timeline's display range with margin
function calculateTimelineRange() {
    let minTime = "23:59";
    let maxTime = "00:00";

    actors.forEach(actor => {
        actor.schedule.forEach(task => {
            if (isTimeBefore(task.startTime, minTime)) {
                minTime = task.startTime;
            }
            if (isTimeBefore(maxTime, task.endTime)) {
                maxTime = task.endTime;
            }
        });
        if (isTimeBefore(maxTime, actor.readyTime)) {
            maxTime = actor.readyTime;
        }
    });

    // Add a margin of 15 minutes to minTime and maxTime
    const startTime = subtractMinutes(minTime, 15);
    const endTime = addMinutes(maxTime, 15);

    console.log("Calculated time range:", { startTime, endTime }); // Log for time range

    // Convert times to Date objects
    const startDate = new Date(`2023-01-01T${startTime}:00`);
    const endDate = new Date(`2023-01-01T${endTime}:00`);

    return { startDate, endDate };
}

// Call the update function when the schedule is generated
updateTimeline();

// Adds minutes to a time and rounds to the nearest 5 minutes
function addMinutes(time, minutes) {
    const [hours, mins] = time.split(':').map(Number);
    const totalMinutes = hours * 60 + mins + minutes;
    const newHours = Math.floor(totalMinutes / 60) % 24;
    const newMinutes = totalMinutes % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMinutes).padStart(2, '0')}`;
}

// Subtracts minutes from a time and rounds to the nearest 5 minutes
function subtractMinutes(time, minutes) {
    const [hours, mins] = time.split(':').map(Number);
    let totalMins = hours * 60 + mins - minutes;
    totalMins = Math.round(totalMins / 5) * 5; // Round to the nearest 5 minutes
    if (totalMins < 0) totalMins += 24 * 60;  // Handle negative times
    const newHours = Math.floor(totalMins / 60) % 24;
    const newMins = totalMins % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
}

// Rounds a time to the nearest 5 minutes
function roundTimeToNearest5(time) {
    const [hours, mins] = time.split(':').map(Number);
    let totalMins = hours * 60 + mins;
    totalMins = Math.round(totalMins / 5) * 5;
    totalMins = totalMins % (24 * 60);
    const newHours = Math.floor(totalMins / 60);
    const newMins = totalMins % 60;
    return `${String(newHours).padStart(2, '0')}:${String(newMins).padStart(2, '0')}`;
}

// Converts a time to minutes (for graphics)
function timeToMinutes(time) {
    const [hours, mins] = time.split(':').map(Number);
    return (hours * 60 + mins);
}

// Compares if time1 is before time2
function isTimeBefore(time1, time2) {
    return timeToMinutes(time1) < timeToMinutes(time2);
}

function isTimeBeforeOrEqual(time1, time2) {
    const [hours1, mins1] = time1.split(':').map(Number);
    const [hours2, mins2] = time2.split(':').map(Number);
    return hours1 < hours2 || (hours1 === hours2 && mins1 <= mins2);
}

// Calculates the difference in minutes between two times
function timeDifferenceInMinutes(time1, time2) {
    return timeToMinutes(time1) - timeToMinutes(time2);
}

function maxTime(time1, time2) {
    return isTimeBefore(time1, time2) ? time2 : time1;
}

function minTime(time1, time2) {
    return isTimeBefore(time1, time2) ? time1 : time2;
}
