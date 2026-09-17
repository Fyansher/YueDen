// Synthetic stress test: no user's game names or paths; never runs an executable.
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const appModule=require('./app-module.cjs'),{pe}=require('../../tests/scan-fixtures.cjs');
(async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'um-scan-scale-')),count=4105;let next=0;
 await Promise.all(Array.from({length:8},async()=>{while(next<count){const n=next++,dir=path.join(root,String(n));await fs.mkdir(dir);await fs.writeFile(path.join(dir,'entry.exe'),pe('Synthetic product '+n));}}));
 const r=await appModule('scan-pipeline').scan([root],'game',{online:false});
 assert.equal(r.items.length,count);assert.equal(r.warnings.length,0);assert.ok(r.metrics.directories>4000);assert.ok(r.metrics.bytes>16*1024*1024);assert.ok(r.metrics.batches>1);
 const report={at:new Date().toISOString(),runtime:process.versions,synthetic:true,expected:count,actual:r.items.length,warnings:r.warnings,metrics:r.metrics,ok:true};
 await fs.writeFile(path.resolve(__dirname,'../docs/test-results/scan-scale.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
})().catch(e=>{console.error(e);process.exitCode=1;});
