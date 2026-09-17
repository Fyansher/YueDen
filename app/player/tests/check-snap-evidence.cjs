// Check captured real-window observations, not fabricated input or full manual acceptance.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const root=path.resolve(__dirname,'../test-artifacts/finish'),rows=[];
for(const [direction,file]of [['left','snap-center-left.json'],['right','snap-right-live.json'],['top','snap-top-live.json'],['bottom','snap-bottom-live.json']]){
 const value=JSON.parse(fs.readFileSync(path.join(root,file))),trace=value.trace?.at(-1);assert.ok(trace,'Actual native trace required');const expected=trace.result.bounds;
 assert.ok(Math.abs(value.source.x-(expected.x-trace.source.left))<=1);assert.ok(Math.abs(value.source.y-(expected.y-trace.source.top))<=1);assert.deepEqual([value.target.x,value.target.y],[700,450]);
 const target=trace.targets.find(t=>t.id===trace.result.state.x?.target||t.id===trace.result.state.y?.target);let gap;
 if(direction==='left')gap=expected.x+expected.width-target.x;else if(direction==='right')gap=expected.x-(target.x+target.width);else if(direction==='top')gap=expected.y+expected.height-target.y;else gap=expected.y-(target.y+target.height);
 assert.ok(Math.abs(gap)<.001);rows.push({direction,nativeBounds:value.source,logicalGap:gap,scale:value.displays[0].scaleFactor,targetUnmoved:true});
}
fs.writeFileSync(path.join(root,'snap-observations.json'),JSON.stringify({time:new Date().toISOString(),method:'Computer Use: system Move menu, then short pointer drag; one observed snap per direction',rows,notVerified:['continuous title-bar drag','Alt held during same gesture','real exact 12/20 thresholds','multi-monitor','hidden/minimized native candidate interaction','native resize'],manual:false},null,2));console.log('4 real-window directional observations validated; NOT full manual snapping acceptance');
