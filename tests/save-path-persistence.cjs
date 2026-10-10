'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const Persistence=require('../app/save-path-persistence');
const Integrity=require('../app/library-integrity');

test('persisting detected save paths preserves required library fields and saves the selected game',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'yueden-save-path-persist-'));
  try{
    const file=path.join(root,'library.json');
    const library={schemaVersion:4,categories:['games'],items:[{id:'stardew',name:'Stardew Valley',type:'game',steamAppId:'413150',savePaths:[]}],playlists:[],referenceRedirects:[],organizationHistory:[],deletedItems:[],deletedSaveSnapshots:[],customLibraryField:{kept:true}};
    fs.writeFileSync(file,JSON.stringify(library));
    const persist=Persistence.create({
      loadLibrary:()=>JSON.parse(fs.readFileSync(file,'utf8')),
      normaliseItem:item=>item,
      dataFile:()=>file,
      writeJson:(target,value)=>{Integrity.guard(target);Integrity.validate(value);fs.writeFileSync(target,JSON.stringify(value));}
    });

    const savePath=path.join(root,'Stardew Valley','Saves');
    const result=persist('stardew',[savePath,savePath,'relative\\path']);
    const saved=Integrity.read(file);

    assert.equal(result.ok,true);
    assert.deepEqual(result.item.savePaths,[savePath]);
    assert.deepEqual(saved.categories,['games']);
    assert.deepEqual(saved.customLibraryField,{kept:true});
    assert.deepEqual(saved.items[0].savePaths,result.item.savePaths);
  }finally{
    fs.rmSync(root,{recursive:true,force:true});
  }
});

test('unknown game does not write the library',()=>{
  let writes=0;
  const persist=Persistence.create({loadLibrary:()=>({categories:[],items:[]}),normaliseItem:item=>item,writeJson:()=>writes++,dataFile:()=>''});
  assert.deepEqual(persist('missing',[]),{ok:false,message:'游戏条目不存在'});
  assert.equal(writes,0);
});
