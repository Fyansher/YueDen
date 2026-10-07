const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const safe= value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

test('cover direction selection remains independent for portrait and landscape sources',()=>{
  const sandbox={settings:{appearance:{libraryLayouts:{game:'cards',book:'small'}}},activeView:'game',CoverClassifier:require('../app/cover-classifier'),structuredClone,$:()=>({classList:{add(){}}}),updateCoverPreview(){}};
  vm.runInNewContext(read('app/cover-ui.js')+'\nglobalThis.coverForUnderTest=coverFor;globalThis.coverDirectionForLayoutUnderTest=coverDirectionForLayout;globalThis.fillCoverFieldsUnderTest=fillCoverFields;globalThis.applyCoverCandidateUnderTest=applyCoverCandidate;globalThis.getEditorCoversUnderTest=getEditorCovers;globalThis.editorCoverDirectionUnderTest=()=>editorCoverDirection;',sandbox);
  const item={cover:'shared.jpg',coverPortrait:'portrait.jpg',coverLandscape:'landscape.jpg'};
  assert.equal(sandbox.coverForUnderTest(item,'portrait'),'portrait.jpg');
  assert.equal(sandbox.coverForUnderTest(item,'landscape'),'landscape.jpg');
  assert.equal(sandbox.coverForUnderTest({coverPortrait:'portrait.jpg'},'landscape'),'portrait.jpg');
  const Classifier=require('../app/cover-classifier');
  assert.equal(Classifier.classify(600,900),'portrait');
  assert.equal(Classifier.classify(920,430),'landscape');
  assert.equal(Classifier.classify(800,780),'square');
  sandbox.fillCoverFieldsUnderTest({type:'game'});
  sandbox.applyCoverCandidateUnderTest({cover:'measured-portrait.jpg',coverDimensions:{width:600,height:900}});
  const measured=sandbox.getEditorCoversUnderTest();
  assert.equal(measured.cover,'');
  assert.equal(measured.coverPortrait,'measured-portrait.jpg');
  assert.equal(measured.coverOrientation,'portrait');
  assert.equal(measured.coverShared,false);
  const shared={cover:'common.jpg',coverShared:true,coverPortrait:'old-portrait.jpg',coverLandscape:'old-landscape.jpg'};
  assert.equal(sandbox.coverForUnderTest(shared,'portrait'),'common.jpg');
  assert.equal(shared.coverPortrait,'old-portrait.jpg');
  assert.equal(shared.coverLandscape,'old-landscape.jpg');
  for(const layout of ['cards','small','list'])assert.equal(sandbox.coverDirectionForLayoutUnderTest({type:'book'},layout),'landscape');
  assert.equal(sandbox.coverDirectionForLayoutUnderTest({type:'game'},'portrait'),'portrait');
  sandbox.settings.appearance.libraryLayouts.book='small';
  sandbox.activeView='book';
  sandbox.fillCoverFieldsUnderTest({type:'book',cover:'shared.jpg',coverPortrait:'portrait.jpg',coverLandscape:'landscape.jpg'});
  assert.equal(sandbox.editorCoverDirectionUnderTest(),'landscape');
  sandbox.fillCoverFieldsUnderTest({type:'game'});
  sandbox.applyCoverCandidateUnderTest({coverPortrait:'portrait-new.jpg'});
  const candidateResult=sandbox.getEditorCoversUnderTest();
  assert.equal(candidateResult.coverPortrait,'portrait-new.jpg');
  assert.equal(candidateResult.coverLandscape,'');
  assert.equal(candidateResult.cover,'');
  assert.equal(candidateResult.coverDisplayDirection,'landscape');
  const ui=read('app/cover-ui.js');
  assert.match(ui,/editorCoverDirection\s*=\s*coverDirection/);
  assert.match(ui,/updateCoverPreview\(coverFor\(editorCovers, editorCoverDirection\), editorCoverDirection\)/);
  assert.match(ui,/preview\.addEventListener\('click', openCoverDialog\)/);
  assert.match(ui,/\$\('editCoverBtn'\)\.addEventListener\('click', openCoverDialog\)/);
});

test('all card layouts use a complete foreground cover and blurred backdrop',()=>{
  const layoutSandbox={settings:{appearance:{libraryLayouts:{}}},activeView:'game',stableCoverFor:(_item,direction)=>direction==='portrait'?'portrait.jpg':'landscape.jpg',esc:safe,cardStatusMarkup:()=>''};
  vm.runInNewContext(read('app/cover-ui.js')+'\n'+read('app/library-cards.js')+'\n'+read('app/library-polish.js')+'\nglobalThis.cardImageUnderTest=cardImage;globalThis.smallCardUnderTest=smallCardHtml;',layoutSandbox);
  const item={id:'fixture',type:'book',name:'测试封面'};
  const portrait=layoutSandbox.cardImageUnderTest(item,'portrait');
  assert.match(portrait,/class="cover-art-backdrop"[^>]*src="portrait\.jpg"/);
  assert.match(portrait,/class="cover-art-image" data-cover-direction="portrait"[^>]*src="portrait\.jpg"/);
  const small=layoutSandbox.smallCardUnderTest(item);
  assert.match(small,/class="cover-art-backdrop"/);
  assert.match(small,/class="cover-art-image" data-cover-direction="landscape"/);
  assert.match(read('app/library-cards.js'),/cardImage\(item,coverDirectionForLayout\(item,layout\)\)/);
  assert.match(read('app/library-cards.js'),/cardImage\(item,coverDirectionForLayout\(item,'list'\)\)/);
});

test('cover stage keeps complete art and uses the frame area for background fill',()=>{
  const css=read('app/cover-stage.css');
  assert.match(css,/filter:\s*blur\(/);
  assert.match(css,/object-fit:\s*contain\s*!important/);
  assert.match(css,/\.library-grid \.cover-art-image\s*\{\s*object-fit:\s*cover\s*!important/);
  assert.match(css,/grid-template-columns:\s*minmax\(220px,\s*340px\) minmax\(0,\s*1fr\)/);
  assert.match(css,/height:\s*clamp\(260px,\s*33vh,\s*330px\)/);
  assert.match(read('app/index.html'),/href="cover-stage\.css"/);
  assert.match(read('app/renderer.js'),/\.card-cover img\.cover-art-image/);
  assert.match(read('app/renderer.js'),/updateCoverPreview\(coverFor\(item, editorCoverDirection\), editorCoverDirection\)/);
  assert.match(read('app/main.js'),/coverDisplayDirection === 'portrait' \|\| value\.coverDisplayDirection === 'landscape'/);
});
