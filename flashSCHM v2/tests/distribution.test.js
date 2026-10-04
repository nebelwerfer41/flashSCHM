import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createState, createActor } from '../js/state.js';
import { serializeRows } from '../js/io/xlsx.js';

// Execute the actual shipped classic script, not just individual source modules.
class Element {
  constructor(tag) {
    this.tag=tag; this.children=[]; this.events={}; this.attributes={};
    this.value=''; this.checked=false; this.disabled=false; this.hidden=false; this.textContent='';
  }
  get childNodes() { return this.children; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children=children; }
  setAttribute(key,value) { this.attributes[key]=value; }
  addEventListener(type,handler) { this.events[type]=handler; }
  reportValidity() { return true; }
  setCustomValidity() {}
}
const descendants=node=>[node,...node.children.filter(n=>n instanceof Element).flatMap(descendants)];
function boot(vis, XLSX) {
  const ids=['actorCount','visualization','professionalSettings','globalRules','actorRows','addActor','defaultReady','applyDefaultReady','readyStatus','generate','export','xlsImportInput','ioStatus','exportStatus','scheduleTableBody','showStartEndCheckbox','showProfessionalCheckbox','diagnostics','versionName','saveSchedule','versionStatus','versionsEmpty','savedSchedules','catalogCount','catalogStatus','importPreview','importPreviewStatus','importPreviewRows','duplicateActionLabel','duplicateAction','applyImport','cancelImport','catalogSearch','addCatalogActors','catalogEmpty','catalogList'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element('div')]));
  const document={
    createElement:tag=>new Element(tag), getElementById:id=>nodes[id],
    querySelectorAll:()=>Object.values(nodes).flatMap(descendants).filter(n=>n.tag==='input'),
  };
  const context=vm.createContext({document,vis,XLSX,console:{error(){}},crypto:undefined});
  vm.runInContext(readFileSync(new URL('../app.bundle.js',import.meta.url),'utf8'),context);
  return nodes;
}
test('double-click distribution uses a classic script and initializes without modules or crypto',()=>{
  const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
  assert.match(html,/<script src="app\.bundle\.js"><\/script>/);
  assert.doesNotMatch(html,/<script[^>]+type="module"/);
  const nodes=boot();
  assert.equal(nodes.professionalSettings.children.length,3);
  assert.ok(nodes.addActor.events.click);
  nodes.addActor.events.click();
  assert.equal(nodes.actorRows.children.length,1);
  const inputs=descendants(nodes.actorRows);
  const name=inputs.find(n=>n.attributes['aria-label']==='Attore');
  name.value='Attore locale';name.events.input();
  const makeup=inputs.find(n=>n.attributes['aria-label']==='Trucco (min)');
  makeup.value='15';makeup.events.input();
  nodes.generate.events.click();
  assert.equal(nodes.scheduleTableBody.children.length,1);
  assert.equal(nodes.scheduleTableBody.children[0].children[0].textContent,'Attore locale');
  assert.equal(nodes.scheduleTableBody.children[0].children[1].textContent,'09:45');
  nodes.addActor.events.click();
  assert.equal(nodes.actorRows.children.length,2);
  assert.equal(nodes.actorCount.textContent,'2');
  assert.equal(nodes.diagnostics.attributes['data-status'],'warning');
  assert.notEqual(nodes.actorRows.children[0].attributes['data-actor-id'],nodes.actorRows.children[1].attributes['data-actor-id']);
});
test('timeline constructor failure cannot prevent professional and actor controls initializing',()=>{
  const nodes=boot({DataSet:class {},Timeline:class {constructor(){throw new Error('unavailable');}}});
  assert.equal(nodes.professionalSettings.children.length,3);
  nodes.addActor.events.click();
  assert.equal(nodes.actorRows.children.length,1);
  assert.match(nodes.visualization.textContent,/Timeline non disponibile/);
});
test('global READY applies to new actors and only overwrites existing actors on command',()=>{
  const nodes=boot();
  assert.equal(nodes.defaultReady.value,'10:00');
  nodes.addActor.events.click();
  const firstReady=()=>descendants(nodes.actorRows).find(n=>n.attributes['aria-label']==='READY · pronti');
  assert.equal(firstReady().value,'10:00');
  nodes.defaultReady.value='09:30';nodes.defaultReady.events.change();
  assert.equal(firstReady().value,'10:00');
  nodes.addActor.events.click();
  const readyFields=()=>descendants(nodes.actorRows).filter(n=>n.attributes['aria-label']==='READY · pronti');
  assert.deepEqual(readyFields().map(n=>n.value),['10:00','09:30']);
  readyFields()[0].value='08:45';readyFields()[0].events.input();
  assert.deepEqual(readyFields().map(n=>n.value),['08:45','09:30']);
  nodes.applyDefaultReady.events.click();
  assert.deepEqual(readyFields().map(n=>n.value),['09:30','09:30']);
  assert.match(nodes.readyStatus.textContent,/2 attori/);
});
test('saved versions can be opened and deleted in the double-click build',()=>{
  const nodes=boot();
  nodes.addActor.events.click();
  const name=descendants(nodes.actorRows).find(n=>n.attributes['aria-label']==='Attore');
  name.value='Original';name.events.input();
  nodes.versionName.value='First plan';
  nodes.saveSchedule.events.click();
  assert.equal(nodes.savedSchedules.children.length,1);
  assert.match(nodes.exportStatus.textContent,/non ancora esportate/);
  name.value='Edited';name.events.input();
  const buttons=descendants(nodes.savedSchedules.children[0]).filter(n=>n.tag==='button');
  buttons.find(n=>n.textContent==='Apri').events.click();
  assert.equal(descendants(nodes.actorRows).find(n=>n.attributes['aria-label']==='Attore').value,'Original');
  buttons.find(n=>n.textContent==='Elimina').events.click();
  assert.equal(nodes.savedSchedules.children.length,0);
});
test('catalog import preview requires a collision choice and supports multi-select copies',async()=>{
  let rows=[
    {ID:'cast-1',Nome:'Mario',DurataTrucco:20,DurataCapelli:0,DurataCostumi:0},
    {ID:'cast-2',Nome:'Luigi',DurataTrucco:15,DurataCapelli:10,DurataCostumi:0},
  ];
  const XLSX={read:()=>({Sheets:{Catalogo:{}}}),utils:{sheet_to_json:(_sheet,options)=>options?.header===1?[['ID','Nome','DurataTrucco','DurataCapelli','DurataCostumi']]:rows}};
  const nodes=boot(undefined,XLSX);
  const file={arrayBuffer:async()=>new ArrayBuffer(0)};
  await nodes.xlsImportInput.events.change({target:{files:[file],value:'catalog.xlsx'}});
  assert.equal(nodes.importPreview.hidden,false);
  assert.equal(nodes.importPreviewRows.children.length,2);
  assert.equal(nodes.applyImport.disabled,false);
  nodes.applyImport.events.click();
  assert.equal(nodes.catalogCount.textContent,'2');
  nodes.catalogSearch.value='Mario';nodes.catalogSearch.events.input();
  assert.equal(nodes.catalogList.children.length,1);
  nodes.catalogSearch.value='';nodes.catalogSearch.events.input();
  for(const checkbox of descendants(nodes.catalogList).filter(n=>n.tag==='input')){
    checkbox.checked=true;checkbox.events.change();
  }
  nodes.addCatalogActors.events.click();
  assert.equal(nodes.actorCount.textContent,'2');
  assert.deepEqual(descendants(nodes.actorRows).filter(n=>n.attributes['aria-label']==='Attore').map(n=>n.value),['Mario','Luigi']);
  rows=[{ID:'cast-1',Nome:'Mario Updated',DurataTrucco:30}];
  await nodes.xlsImportInput.events.change({target:{files:[file],value:'catalog.xlsx'}});
  assert.equal(nodes.applyImport.disabled,true);
  assert.match(nodes.importPreviewStatus.textContent,/1 con ID già presente/);
  nodes.duplicateAction.value='replace';nodes.duplicateAction.events.change();
  assert.equal(nodes.applyImport.disabled,false);
  nodes.applyImport.events.click();
  assert.equal(descendants(nodes.actorRows).find(n=>n.attributes['aria-label']==='Attore').value,'Mario');
  assert.match(nodes.catalogList.children[0].children[0].children[1].children[0].textContent,/Mario Updated/);
});
test('one import control previews a full project before replacing the open plan',async()=>{
  const imported=createState();
  imported.actors.push(createActor({name:'Imported'}));
  imported.actorCatalog=[{id:'cast-1',name:'Catalog actor',durations:{trucco:15,capelli:0,costumi:0}}];
  const rows=serializeRows(imported);
  const XLSX={
    read:()=>({Sheets:Object.fromEntries(Object.keys(rows).map(name=>[name,{name}]))}),
    utils:{sheet_to_json:(sheet,options)=>options?.header===1
      ? [['ID','Nome','DurataTrucco','DurataCapelli','DurataCostumi']]
      : rows[sheet.name]},
  };
  const nodes=boot(undefined,XLSX);
  nodes.addActor.events.click();
  assert.equal(nodes.actorCount.textContent,'1');
  const file={arrayBuffer:async()=>new ArrayBuffer(0)};
  await nodes.xlsImportInput.events.change({target:{files:[file],value:'project.xlsx'}});
  assert.equal(nodes.importPreview.hidden,false);
  assert.match(nodes.importPreviewStatus.textContent,/1 schede catalogo/);
  assert.equal(nodes.catalogCount.textContent,'0');
  nodes.applyImport.events.click();
  assert.equal(nodes.importPreview.hidden,true);
  assert.equal(nodes.catalogCount.textContent,'1');
  assert.equal(descendants(nodes.actorRows).find(n=>n.attributes['aria-label']==='Attore').value,'Imported');
  assert.match(nodes.exportStatus.textContent,/Nessuna modifica/);
});
