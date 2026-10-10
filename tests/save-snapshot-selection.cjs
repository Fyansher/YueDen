'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Selection = require('../app/save-snapshot-selection');

test('snapshot-only result can select and then clear all orphan snapshots', () => {
  const snapshots = ['orphan-a', 'orphan-b'];
  assert.equal(Selection.hasRows([], snapshots), true);
  assert.equal(Selection.allSelected([], snapshots, [], []), false);
  const selected = Selection.toggleAll([], snapshots, [], []);
  assert.deepEqual(selected, { resourceIds: [], snapshotIds: snapshots, clear: false });
  assert.equal(Selection.allSelected([], snapshots, selected.resourceIds, selected.snapshotIds), true);
  assert.deepEqual(Selection.toggleAll([], snapshots, selected.resourceIds, selected.snapshotIds), { resourceIds: [], snapshotIds: [], clear: true });
});

test('select all toggles resources and their snapshots together, including empty groups', () => {
  const resources = ['game-a', 'game-b'], snapshots = ['save-a', 'save-b'];
  const selected = Selection.toggleAll(resources, snapshots, ['game-a'], ['save-a']);
  assert.deepEqual(selected, { resourceIds: resources, snapshotIds: snapshots, clear: false });
  assert.equal(Selection.allSelected(resources, snapshots, selected.resourceIds, selected.snapshotIds), true);
  assert.deepEqual(Selection.toggleAll(resources, snapshots, selected.resourceIds, selected.snapshotIds), { resourceIds: [], snapshotIds: [], clear: true });
  assert.equal(Selection.hasRows([], []), false);
  assert.equal(Selection.allSelected([], []), false);
});

test('snapshot group controls toggle only their snapshots without mutating the resource selection',()=>{
  const ids=['save-a','save-b'];
  const selected=Selection.toggleSnapshots(ids,[]);
  assert.deepEqual(selected,{snapshotIds:ids,clear:false});
  assert.deepEqual(Selection.toggleSnapshots(ids,selected.snapshotIds),{snapshotIds:[],clear:true});
  assert.deepEqual(Selection.toggleSnapshots(ids,['save-a']),{snapshotIds:['save-a','save-b'],clear:false});
});

test('snapshot group hit area safely catches clicks slightly outside its visual button',()=>{
  const control={getBoundingClientRect:()=>({left:100,right:128,top:200,bottom:228})};
  assert.equal(Selection.isWithinGroupControlHitArea(control,90,214),true);
  assert.equal(Selection.isWithinGroupControlHitArea(control,130,214),true);
  assert.equal(Selection.isWithinGroupControlHitArea(control,87,214),false);
  assert.equal(Selection.isWithinGroupControlHitArea(control,110,236),false);
});

test('snapshot panel controls stay independent while other panel areas can select the resource',()=>{
  const target=matches=>({selector:'',closest(value){this.selector=value;return matches?this:null;}});
  const button=target(true),rowCheckbox=target(true),rowText=target(false),panelBackground=target(false);
  assert.equal(Selection.isSnapshotPanelControlTarget(button),true);
  assert.match(button.selector,/\.card-save-snapshots button/);
  assert.equal(Selection.isSnapshotPanelControlTarget(rowCheckbox),true);
  assert.match(rowCheckbox.selector,/\.snapshot-row-select/);
  assert.equal(Selection.isSnapshotPanelControlTarget(rowText),false);
  assert.equal(Selection.isSnapshotPanelControlTarget(panelBackground),false);
});

test('clicking a snapshot row selects its snapshot in selection mode but leaves row controls alone',()=>{
  const target=matches=>({selector:'',closest(value){this.selector=value;return matches?this:null;}});
  const text=target(false),checkbox=target(true),button=target(true);
  assert.equal(Selection.shouldSelectSnapshotFromRow(true,text),true);
  assert.match(text.selector,/\.snapshot-row-select/);
  assert.equal(Selection.shouldSelectSnapshotFromRow(true,checkbox),false);
  assert.equal(Selection.shouldSelectSnapshotFromRow(true,button),false);
  assert.equal(Selection.shouldSelectSnapshotFromRow(false,text),false);
});

test('snapshot group button pointer and click events are isolated from the parent card and repeated clicks toggle snapshots only',()=>{
  const button={},resourceSelection=new Set(['game-a']);let snapshots=new Set(),prevented=false,pointerStopped=false,stopped=false;
  Selection.bindGroupControl(button,()=>['save-a','save-b'],()=>snapshots,result=>{snapshots=new Set(result.snapshotIds);});
  button.onpointerdown({button:0,stopPropagation(){pointerStopped=true;}});
  const click=()=>button.onclick({preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});
  click();assert.deepEqual([...snapshots],['save-a','save-b']);
  click();assert.deepEqual([...snapshots],[]);
  assert.equal(pointerStopped,true);assert.equal(prevented,true);assert.equal(stopped,true);assert.deepEqual([...resourceSelection],['game-a']);
});

test('resource deletion keeps explicitly selected cloud-only snapshots', () => {
  const cloud={id:'cloud-only',itemId:'game-a',remoteOnly:true};
  const plan=Selection.planDeletion({resourceIds:['game-a'],localSnapshots:[],visibleSnapshots:[cloud],selectedSnapshots:[cloud]});
  assert.deepEqual(plan.explicit,[cloud]);
  assert.deepEqual(plan.additional,[]);
});

test('snapshot group checkbox uses an isolated button above the resource card click layer',()=>{
  const fs=require('node:fs'),path=require('node:path'),renderer=fs.readFileSync(path.join(__dirname,'../app/renderer.js'),'utf8'),controls=fs.readFileSync(path.join(__dirname,'../app/save-snapshot-selection.js'),'utf8'),css=fs.readFileSync(path.join(__dirname,'../app/library-actions.css'),'utf8');
  assert.doesNotMatch(renderer,/for\(const section of all\('\.card-save-snapshots',grid\)\)section\.onclick=event=>event\.stopPropagation\(\)/);
  assert.match(renderer,/const inSnapshotPanel=event\.target\.closest\('\.card-save-snapshots'\);\s*if\(inSnapshotPanel&&SaveSnapshotSelection\.isSnapshotPanelControlTarget\(event\.target\)\)return;/);
  assert.match(renderer,/if\(librarySelection\.active&&!action\)\{toggleLibrarySelection\(item\.id,event\);return;\}\s*if\(inSnapshotPanel\)return;/);
  assert.match(controls,/function isSnapshotPanelControlTarget\(target\)/);
  assert.match(renderer,/<button id="'\+esc\(inputId\)\+'" type="button" class="snapshot-group-select" role="checkbox"/);
  assert.match(renderer,/SaveSnapshotSelection\.bindGroupControl\(control,/);
  assert.ok(renderer.includes("const missedGroupControl=all('.snapshot-group-select:not(:disabled)',card).find(control=>SaveSnapshotSelection.isWithinGroupControlHitArea"));
  assert.match(controls,/control\.onpointerdown = event => \{\s*if \(event\.button === 0\) event\.stopPropagation\(\);\s*\};/);
  assert.match(controls,/control\.onclick = event => \{\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);/);
  assert.match(css,/\.resource-card \.card-save-snapshots\{position:relative;z-index:12;/);
  assert.match(css,/\.snapshot-group-select::before\{position:absolute;inset:-7px;/);
  assert.match(css,/\.snapshot-group-select\[aria-checked="true"\]:hover \.snapshot-checkmark,[\s\S]*?background:var\(--accent\);/);
  assert.match(css,/box-shadow:0 0 0 3px color-mix\(in srgb,var\(--accent\) 27%,transparent\)/);
  assert.match(css,/\.resource-card \.card-select \{ position:absolute; right:8px; top:8px; z-index:9;/);
});

test('associated snapshots are counted once and unrelated orphans remain outside a resource delete', () => {
  const local={id:'local',itemId:'game-a'},localCloudCopy={id:'local',itemId:'game-a'},cloud={id:'cloud',itemId:'game-a',remoteOnly:true},orphan={id:'orphan',itemId:'deleted-game'};
  const visible=[localCloudCopy,cloud,orphan];
  const plan=Selection.planDeletion({resourceIds:new Set(['game-a']),localSnapshots:[local],visibleSnapshots:visible,selectedSnapshots:[cloud]});
  assert.deepEqual(plan.explicit,[cloud]);
  assert.deepEqual(plan.additional,[local]);
  assert.deepEqual(visible,[localCloudCopy,cloud,orphan]);
});
