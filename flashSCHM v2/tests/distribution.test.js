import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Execute the actual shipped classic script, not just individual source modules.
class Element {
  constructor(tag) {
    this.tag=tag; this.children=[]; this.events={}; this.attributes={};
    this.value=''; this.checked=false; this.textContent='';
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
function boot(vis) {
  const ids=['actorCount','visualization','professionalSettings','globalRules','actorRows','addActor','defaultReady','applyDefaultReady','readyStatus','generate','export','xlsImportInput','ioStatus','scheduleTableBody','showStartEndCheckbox','showProfessionalCheckbox','diagnostics'];
  const nodes=Object.fromEntries(ids.map(id=>[id,new Element('div')]));
  const document={
    createElement:tag=>new Element(tag), getElementById:id=>nodes[id],
    querySelectorAll:()=>Object.values(nodes).flatMap(descendants).filter(n=>n.tag==='input'),
  };
  const context=vm.createContext({document,vis,console:{error(){}},crypto:undefined});
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
