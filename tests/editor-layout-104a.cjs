const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

test('editor fields follow the requested visual order without changing saved field IDs',()=>{
  const form=read('app/index.html');
  const ordered=['id="fieldName"','id="steamAppIdField"','id="metadataBtn"','id="fieldType"','id="fieldGenres"','id="fieldCategories"','class="field-row score-row"','id="gamePlatforms"','id="fieldStatus"','id="fieldCompletedDate"','id="fieldPlaytime"'];
  let last=-1;
  for(const token of ordered){const at=form.indexOf(token);assert.ok(at>last,`${token} should follow the previous field`);last=at;}
  const renderer=read('app/renderer.js');
  assert.match(renderer,/show\('#playtimeField', game \|\| publication \|\| media\)/);
  assert.match(renderer,/media \? '观看时长（小时）'/);
  assert.match(renderer,/playtime: valueFor\('fieldPlaytime'\) \? Number\(valueFor\('fieldPlaytime'\)\) : null/);
  const editorFields=read('app/editor-fields.js');
  assert.match(editorFields,/hint\.textContent = candidate\.metadataSource \|\| ''/);
  assert.doesNotMatch(editorFields,/已取得可用信息|未确认：/);
});

test('movie and anime viewing hours remain included in the existing duration statistics',()=>{
  const usage=require(path.join(root,'app/usage-model.js'));
  const totals=usage.groups([
    {id:'movie-entry',type:'movie',playtime:2.5},
    {id:'anime-entry',type:'anime',playtime:18},
    {id:'book-entry',type:'book',playtime:4}
  ],{});
  assert.equal(totals.find(row=>row.type==='movie').hours,2.5);
  assert.equal(totals.find(row=>row.type==='anime').hours,18);
  assert.equal(totals.find(row=>row.type==='book').hours,4);
});

test('editor anchors name and scores to the cover, centers the type row, and removes the progress divider',()=>{
  const css=read('app/cover-stage.css');
  assert.match(css,/#editorForm \.cover-edit-button\s*\{[^}]*opacity:\s*\.36/s);
  assert.match(css,/#editorForm \.editor-cover-wrap:hover \.cover-edit-button,[\s\S]*?opacity:\s*\.85/);
  assert.match(css,/#editorForm \.editor-identity\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\) auto minmax\(0, 1fr\) auto/s);
  assert.match(css,/#editorForm \.editor-name-row\s*\{[^}]*grid-row:\s*1/s);
  assert.match(css,/#editorForm \.editor-type-row\s*\{[^}]*grid-row:\s*3;[^}]*align-self:\s*center/s);
  assert.match(css,/#editorForm \.score-row\s*\{[^}]*grid-row:\s*5;[^}]*align-self:\s*end/s);
  assert.match(css,/#editorForm \.score-row #platformRatingDisplay\s*\{[^}]*flex:\s*1;[^}]*align-items:\s*stretch/s);
  assert.match(css,/#editorForm \.score-row \.platform-gauge-column\s*\{[^}]*justify-content:\s*space-between/s);
  assert.match(css,/#editorForm \.editor-name-row > \.field\s*\{[^}]*line-height:\s*1\.5/s);
  assert.match(css,/#editorForm \.editor-metadata-actions\s*\{[^}]*grid-template-rows:\s*calc\(1lh \+ 6px\) 36px auto/s);
  assert.match(css,/#editorForm #metadataBtn\s*\{[^}]*grid-row:\s*2/s);
  assert.match(css,/#editorForm \.metadata-coverage\s*\{[^}]*grid-row:\s*3;[^}]*margin-top:\s*2px/s);
  assert.match(css,/#editorForm \.credits-grid\s*\{\s*border-top:\s*0/s);
  assert.match(css,/@media \(max-width: 660px\)/);
});
