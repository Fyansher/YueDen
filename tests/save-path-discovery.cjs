'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const Discovery=require('../app/save-path-discovery');

const manifest=`"Example Game":
  files:
    <winAppData>/Example Game:
      tags:
        - save
    <winLocalAppData>/Example Game/config:
      tags: [config]
    <winDocuments>/Example Game:
      when:
        - os: mac
      tags: [save]
    <base>/saves:
      tags: [save]
  installDir:
    ExampleFolder: {}
  steam:
    id: 123456
"Other Game":
  files:
    <winAppData>/Other:
      tags: [save]
  steam:
    id: 999999
`;

test('Steam AppID maps only Windows save-tagged paths and expands installed Steam base',()=>{
  const root=fs.mkdtempSync(path.join(__dirname,'.save-path-discovery-'));
  try{
    const user=path.join(root,'User'),roaming=path.join(user,'Roaming'),local=path.join(user,'Local'),docs=path.join(user,'Documents');
    const steam=path.join(root,'Steam'),library=path.join(root,'Library'),common=path.join(library,'steamapps','common','ExampleFolder');
    const expected=[path.join(roaming,'Example Game'),path.join(common,'saves')];
    for(const folder of [...expected,path.join(local,'Example Game','config')])fs.mkdirSync(folder,{recursive:true});
    fs.mkdirSync(path.join(library,'steamapps'),{recursive:true});fs.mkdirSync(path.join(steam,'steamapps'),{recursive:true});
    fs.writeFileSync(path.join(steam,'steamapps','libraryfolders.vdf'),`"libraryfolders" {\n  "0" { "path" "${library.replaceAll('\\','\\\\')}" }\n}`);
    fs.writeFileSync(path.join(library,'steamapps','appmanifest_123456.acf'),'"AppState" { "installdir" "ExampleFolder" }');
    const result=Discovery.resolveSavePaths({id:'g',type:'game',steamAppId:'123456',savePaths:[]},{manifestText:manifest,env:{APPDATA:roaming,LOCALAPPDATA:local,USERPROFILE:user,USERNAME:'Test'},home:user,documents:docs,knownRoots:[steam]});
    assert.equal(result.ok,true);assert.equal(result.status,'detected');assert.deepEqual(result.paths.sort(),expected.sort());
    assert.equal(Discovery.resolveSavePaths({type:'game',steamAppId:'123456',savePaths:['D:\\Manual']},{manifestText:manifest}).status,'manual-preserved');
    assert.equal(Discovery.resolveSavePaths({type:'game',steamAppId:'999999',savePaths:[]},{manifestText:manifest,env:{APPDATA:roaming,LOCALAPPDATA:local,USERPROFILE:user,USERNAME:'Test'},home:user,documents:docs}).ok,false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('Steam library VDF handles escaped Windows library paths',()=>{
  assert.deepEqual(Discovery.parseSteamLibraryPaths('"0" { "path" "D:\\\\Steam Library" }'),['D:\\Steam Library']);
});

test('manifest refresh uses ETag cache and an explicit timeout',async()=>{
  const root=fs.mkdtempSync(path.join(__dirname,'.save-manifest-cache-'));let calls=0,headers;
  try{
    const fetchImpl=async(_url,options)=>{calls++;headers=options.headers;assert.ok(options.signal);return calls===1?{ok:true,status:200,headers:{get:name=>name==='etag'?'"v1"':String(Buffer.byteLength(manifest))},arrayBuffer:async()=>Buffer.from(manifest)}:{ok:false,status:304,headers:{get:()=>null}};};
    assert.equal(await Discovery.loadManifest(root,{fetchImpl}),manifest);
    assert.equal(await Discovery.loadManifest(root,{fetchImpl}),manifest);
    assert.equal(calls,2);assert.equal(headers['If-None-Match'],'"v1"');
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
