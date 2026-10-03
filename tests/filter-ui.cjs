const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ResourceFilters=require('../app/filter-ui');

test('存档筛选向用户显示全部、有存档、无存档三个状态',()=>{
  const filters=new ResourceFilters();
  assert.equal(filters.shouldShowSaveFilter('game'),true);
  assert.equal(filters.shouldShowSaveFilter('all'),false);
  assert.deepEqual(filters.saveFilterOptions(),['all','has','none']);
  assert.equal(filters.saveFilterLabel('all'),'全部存档');
  assert.equal(filters.saveFilterLabel('has'),'有存档');
  assert.equal(filters.saveFilterLabel('none'),'无存档');
  assert.equal(filters.saveFilterLabel('unknown'),'全部存档');
});

test('有无存档筛选只根据真实快照数量判断，并能随首份/末份快照切换',()=>{
  const filters=new ResourceFilters();
  assert.equal(filters.saveFilterMatches('all',0),true);
  assert.equal(filters.saveFilterMatches('has',0),false);
  assert.equal(filters.saveFilterMatches('none',0),true,'仅设置了存档路径时仍然无存档');
  assert.equal(filters.saveFilterMatches('has',1),true,'创建首份快照后立即属于有存档');
  assert.equal(filters.saveFilterMatches('none',1),false);
  assert.equal(filters.saveFilterMatches('has',0),false,'删除最后一份快照后立即退出有存档');
  assert.equal(filters.saveFilterMatches('none',0),true);
});

test('资源详情把位置与备份操作统一放在始终存在的存档快照区域',()=>{
  const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'app','index.html'),'utf8'),renderer=fs.readFileSync(path.join(root,'app','renderer.js'),'utf8'),css=fs.readFileSync(path.join(root,'app','styles.css'),'utf8');
  const start=html.indexOf('<section id="backupList"'),end=html.indexOf('</section>',start),panel=html.slice(start,end);
  assert.ok(start>=0&&end>start,'snapshot panel is part of the editor markup, independent of snapshot count');
  for(const id of ['pickSavePathsBtn','backupSaveBtn','savePathOpenBtn','savePathDisplay','backupSnapshotRows'])assert.ok(panel.includes(`id="${id}"`),id);
  assert.ok(!html.includes('id="openBackupBtn"'),'there is no duplicate open-backup-folder button');
  assert.ok(renderer.includes('native.revealLocal(target)'),'clicking the displayed source path opens its existing location');
  assert.ok(renderer.includes('resourceFilters.saveFilterMatches(saveFilter,snapshotsFor(item.id).length)'),'filter reads the real snapshot index, not whether a path is configured');
  assert.ok(renderer.includes('refreshSnapshotIndex(true)'),'snapshot mutations rerender the game list and filter counts');
  assert.match(css,/\.backup-path-value\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/s);
});
