const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const appModule=require('./app-module.cjs'),{fixture,pe}=require('../../tests/scan-fixtures.cjs'),Scan=appModule('scan-pipeline');
test('大型配套素材不消耗发现预算，卸载器不拆成资源，安装记录准确确认',async()=>{
 const f=await fixture(),id='a'.repeat(32);
 await f.put('Library/One/Main.exe',pe('Example Game'));await f.put('Library/One/uninstall.exe',pe('Uninstaller'));
 await f.put('Library/One/Main_Data/payload.bin');await f.put('Library/One/.egstore/'+id+'.mancpn','{}');
 await Promise.all(Array.from({length:100},(_,i)=>f.put('Library/One/assets/'+i+'.bin')));
 const manifest=path.join(f.root,'manifests');await f.put('manifests/'+id+'.item',JSON.stringify({InstallLocation:path.join(f.root,'Library/One'),DisplayName:'Verified Example',LaunchExecutable:'Main.exe',AppCategories:['games'],CatalogItemId:'example',OwnershipToken:'DO NOT RETAIN'}));
 const r=await Scan.scan([path.join(f.root,'Library')],'game',{epicManifestDirectory:manifest,budget:{maxFiles:20}});
 assert.equal(r.items.length,1);assert.equal(r.items[0].name,'Verified Example');assert.equal(r.items[0].reviewRequired,false);assert.equal(r.items[0].localFiles.length,2);
 assert.match(r.items[0].localPath,/Main.exe$/);assert.equal(r.warnings.length,0);assert.ok(r.checked<20);assert.ok(!JSON.stringify(r).includes('DO NOT RETAIN'));
 const again=await Scan.scan([path.join(f.root,'Library')],'game',{epicManifestDirectory:manifest,budget:{maxFiles:20}});assert.equal(again.items[0].id,r.items[0].id);
});
test('不同独立程序不因为同目录而吞并，二级二进制入口能发现',async()=>{
 const f=await fixture();await f.put('Mixed/A.exe',pe('Product A'));await f.put('Mixed/B.exe',pe('Product B'));
 const r=await Scan.scan([path.join(f.root,'Mixed')],'game');assert.equal(r.items.length,2);assert.ok(r.items.every(i=>i.reviewRequired));
 await f.put('Nested/Binaries/Win64/Launch.exe',pe('Product C'));
 const nested=await Scan.scan([path.join(f.root,'Nested')],'game');assert.equal(nested.items.length,1);assert.match(nested.items[0].localPath,/Launch.exe$/);
});
