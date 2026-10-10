/* Shared selection state for the library and the tag-management page. */
class ResourceFilters {
  constructor() {
    this.values = Object.fromEntries(['statusFilter', 'platformFilter', 'genreFilter', 'categoryFilter', 'yearFilter', 'ratingFilter'].map(id => [id, new Set()]));
    this.labels = { statusFilter: '状态', platformFilter: '平台', genreFilter: '标签', categoryFilter: '分类', yearFilter: '发售年份', ratingFilter: '个人评分' };
    this.completion = { mode:'range', from:'', to:'', on:'' };
  }
  selected(id) { return [...(this.values[id] || [])]; }
  toggle(id, value) { const set = this.values[id]; if (!set || value === 'all') return; set.has(value) ? set.delete(value) : set.add(value); }
  togglePlatform(key) {
    const set=this.values.platformFilter,current=[...set].find(value=>value.startsWith(key+':'));
    if(!current)set.add(key+':any');else if(current.endsWith(':any')){set.delete(current);set.add(key+':played');}else set.delete(current);
  }
  clearTagFilters() { this.values.genreFilter.clear(); this.values.categoryFilter.clear(); }
  clear() { Object.values(this.values).forEach(set => set.clear()); this.completion={mode:'range',from:'',to:'',on:''}; }
  hasCompletion() { const c=this.completion;return Boolean(c.mode==='exact'?c.on:c.from||c.to); }
  completionLabel() {const c=this.completion;return '完成日期：'+(c.mode==='exact'?c.on:(c.from||'不限')+' 至 '+(c.to||'不限'));}
  matches(item, ignore = []) {
    if(!ignore.includes('completion') && this.hasCompletion()) {
      const date=String(item.completedDate||'').slice(0,10),c=this.completion;
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
      if(c.mode==='exact'?date!==c.on:(c.from&&date<c.from)||(c.to&&date>c.to))return false;
    }
    const any = (id, value) => !this.values[id].size || this.values[id].has(value);
    if (!ignore.includes('statusFilter') && this.values.statusFilter.size && !this.selected('statusFilter').some(value => {
      const status=StatusModel.normalize(item.status,item.type);
      if(value.startsWith('phase:'))return StatusModel.stage(status)===value.slice(6);
      if(value==='special:mastered')return item.type==='game'&&StatusModel.phase(status)==='mastered';
      return item.status===value;
    })) return false;
    const platforms=this.selected('platformFilter');
    if(!ignore.includes('platformFilter')&&platforms.length&&(!item||item.type!=='game'||!platforms.some(value=>{const [key,state]=value.split(':');const actual=PlatformModel.state(item,key);return state==='any'?actual!=='unchecked':state==='played'&&actual==='played';})))return false;
    if (!this.selected('genreFilter').every(tag => (item.genres || []).includes(tag))) return false;
    if (!this.selected('categoryFilter').every(tag => (item.categories || []).includes(tag))) return false;
    if (!any('yearFilter', String(item.releaseDate || '').slice(0, 4))) return false;
    const ratings = this.selected('ratingFilter');
    return !ratings.length || ratings.some(value => value === 'unrated' ? Number(item.rating) === 0 : Number(item.rating) === Number(value));
  }
  chips(host, change) {
    host.replaceChildren();
    if(this.hasCompletion()){const chip=document.createElement('button');chip.type='button';chip.className='selected-filter-chip';chip.dataset.filter='completion';chip.textContent=this.completionLabel()+' ×';chip.setAttribute('aria-label','取消完成日期筛选');chip.onclick=()=>{this.completion={mode:'range',from:'',to:'',on:''};change();};host.appendChild(chip);}
    Object.entries(this.values).forEach(([id, values]) => values.forEach(value => {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'selected-filter-chip';
      const phaseLabels={pending:'未开始',active:'进行中',completed:'已完成',dropped:'已弃坑'};
      const [platformKey,platformState]=id==='platformFilter'?value.split(':'):[];
      const label = id === 'ratingFilter' ? (value === 'unrated' ? '未评分' : value + ' 星') : id === 'statusFilter'&&value.startsWith('phase:')?phaseLabels[value.slice(6)]||value:id==='statusFilter'&&value==='special:mastered'?'全成就':id==='platformFilter'?(PlatformModel.labels[platformKey]||platformKey)+(platformState==='played'?' · 我玩过':' · 平台'):value;
      button.textContent = label + ' ×'; button.setAttribute('aria-label', '取消' + this.labels[id] + '：' + label);
      button.dataset.filter = id; button.dataset.value = value;
      button.addEventListener('click', () => { this.values[id].delete(value); change(); }); host.appendChild(button);
    }));
    const saveSelect=document.getElementById('saveFilter');if(saveSelect&&saveSelect.value&&saveSelect.value!=='all'&&!saveSelect.classList.contains('hidden')){const button=document.createElement('button');button.type='button';button.className='selected-filter-chip';button.dataset.filter='saveFilter';button.textContent='存档 · '+this.saveFilterLabel(saveSelect.value)+' ×';button.setAttribute('aria-label','取消存档筛选：'+this.saveFilterLabel(saveSelect.value));button.onclick=()=>{saveSelect.value='all';change();};host.appendChild(button);}
  }
  render(items, onChange) {
    const root = document.getElementById('filters'); if (!root) return;
    let host = document.getElementById('multiFilterControls');
    if (!host) { host = document.createElement('div'); host.id = 'multiFilterControls'; root.prepend(host); }
    let chips = document.getElementById('activeFilterChips');
    if (!chips) { chips = document.createElement('div'); chips.id = 'activeFilterChips'; chips.className = 'selected-filter-chips'; root.prepend(chips); }
    this.chips(chips, onChange);
    const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
    const phases=[['pending','未开始'],['active','进行中'],['completed','已完成'],['dropped','已弃坑']],statusChoices=phases.map(([phase,label])=>({value:'phase:'+phase,label,count:items.filter(item=>StatusModel.stage(StatusModel.normalize(item.status,item.type))===phase).length})).filter(choice=>choice.count||this.values.statusFilter.has(choice.value));
    const masteredCount=items.filter(item=>item.type==='game'&&StatusModel.phase(StatusModel.normalize(item.status,item.type))==='mastered').length;
    if(masteredCount||this.values.statusFilter.has('special:mastered'))statusChoices.push({value:'special:mastered',label:'全成就',count:masteredCount});
    const ratingValues=items.map(item=>Number(item.rating)).filter(value=>Number.isFinite(value)&&value>0).map(value=>String(value));
    const hasUnrated=items.some(item=>!(Number(item.rating)>0));
    const options={
      statusFilter:statusChoices,
      genreFilter:unique(items.flatMap(item=>item.genres||[])),
      categoryFilter:unique(items.flatMap(item=>item.categories||[])),
      yearFilter:unique(items.map(item=>String(item.releaseDate||'').slice(0,4)).filter(year=>/^\d{4}$/.test(year))).reverse(),
      ratingFilter:[...(hasUnrated||this.values.ratingFilter.has('unrated')?['unrated']:[]),...unique(ratingValues).sort((a,b)=>Number(a)-Number(b))]
    };
    const order=['statusFilter','platformFilter','genreFilter','categoryFilter','yearFilter','ratingFilter'];
    for(const id of order){if(id==='platformFilter'){this.renderPlatformFilter(host,items,onChange);continue;}const choices=options[id].map(value=>typeof value==='string'?{value,label:id==='ratingFilter'?(value==='unrated'?'未评分':value+' 星'):value}:value);this.renderChoiceFilter(host,id,choices,onChange);}
    this.renderCompletion(host,onChange,items);
    this.renderSaveFilter(host,onChange,items);
    for(const id of ['statusFilter','platformFilter','genreFilter','categoryFilter','yearFilter','ratingFilter','completion','saveFilter']){const control=host.querySelector('[data-filter="'+id+'"]');if(control)host.appendChild(control);}
    if(!host.dataset.exclusiveMenus){host.dataset.exclusiveMenus='1';host.addEventListener('click',event=>{const summary=event.target.closest('summary');if(!summary)return;const current=summary.parentElement;host.querySelectorAll('details').forEach(menu=>{if(menu!==current)menu.open=false;});});document.addEventListener('pointerdown',event=>{if(!host.contains(event.target))host.querySelectorAll('details').forEach(menu=>menu.open=false);});}
  }
  ensureDropdown(host,id) {
    let details=host.querySelector('[data-filter="'+id+'"]');
    if(!details){details=document.createElement('details');details.className='filter-dropdown';details.dataset.filter=id;details.innerHTML='<summary></summary><div class="filter-options" role="group"></div>';host.appendChild(details);}
    return details;
  }
  hideDropdown(details) { if(details){details.open=false;details.hidden=true;} }
  renderChoiceFilter(host,id,choices,onChange) {
    let details=host.querySelector('[data-filter="'+id+'"]');
    if(!choices.length){this.hideDropdown(details);return;}
    details=this.ensureDropdown(host,id);const selectedValues=this.values[id],summary=details.querySelector('summary'),menu=details.querySelector('.filter-options');
    details.hidden=false;
    summary.textContent=this.labels[id]+(selectedValues.size?' · '+selectedValues.size+' 项':' · 全部');menu.setAttribute('aria-label',this.labels[id]);
    const focused=menu.contains(document.activeElement)?document.activeElement.dataset.value:null,retained=new Map([...menu.querySelectorAll('button[data-value]')].map(node=>[node.dataset.value,node])),available=new Set(choices.map(choice=>choice.value));
    for(const [value,node]of retained)if(!available.has(value))node.remove();
    for(const choice of choices){const button=retained.get(choice.value)||document.createElement('button'),selected=selectedValues.has(choice.value);button.type='button';button.dataset.value=choice.value;button.className='filter-option'+(selected?' selected':'');button.setAttribute('aria-pressed',String(selected));button.textContent=choice.label;button.disabled=Boolean(choice.count===0&&!selected);button.title=choice.count===0?'当前页面没有此状态资源':'';button.onclick=event=>{event.preventDefault();event.stopPropagation();this.toggle(id,choice.value);onChange();};if(button.parentElement!==menu)menu.appendChild(button);}
    if(focused)[...menu.querySelectorAll('button[data-value]')].find(node=>node.dataset.value===focused)?.focus({preventScroll:true});
  }
  renderPlatformFilter(host,items,onChange) {
    const games=items.filter(item=>item.type==='game'),details=host.querySelector('[data-filter="platformFilter"]');
    if(!games.length){this.hideDropdown(details);return;}
    const menuOptions=[...new Set(games.flatMap(item=>PlatformModel.detect(item)))],selected=this.values.platformFilter;
    if(!menuOptions.length&&!selected.size){this.hideDropdown(details);return;}
    const dropdown=this.ensureDropdown(host,'platformFilter'),summary=dropdown.querySelector('summary'),menu=dropdown.querySelector('.filter-options');
    dropdown.hidden=false;
    summary.textContent=this.labels.platformFilter+(selected.size?' · '+selected.size+' 项':' · 全部');menu.classList.add('platform-filter-options');menu.setAttribute('aria-label','游戏平台筛选');menu.replaceChildren();
    if(!menuOptions.length){this.hideDropdown(dropdown);return;}
    for(const key of menuOptions){const choice=[...selected].find(value=>value.startsWith(key+':')),state=choice?.split(':')[1]||'',button=document.createElement('button');button.type='button';button.className='filter-option platform-filter-option'+(state?' selected':'');button.dataset.value=key;button.dataset.platformState=state==='played'?'played':state?'release':'unchecked';button.setAttribute('aria-pressed',String(Boolean(state)));button.innerHTML=PlatformModel.icons({platforms:[key],playedPlatforms:state==='played'?[key]:[]})+'<span>'+PlatformModel.labels[key]+'</span>'+(state?'<small>'+(state==='played'?'我玩过':'平台')+'</small>':'');button.title=state==='played'?'只显示标记为我玩过的平台':state?'显示拥有此平台的游戏（发行或玩过）':'点击筛选拥有此平台的游戏，再筛选我玩过的游戏';button.setAttribute('aria-label',PlatformModel.labels[key]+(state==='played'?'，我玩过':state?'，平台存在':'，未筛选'));button.onclick=event=>{event.preventDefault();event.stopPropagation();this.togglePlatform(key);onChange();};menu.appendChild(button);}
  }
  shouldShowSaveFilter(view) { return view === 'game'; }
  saveFilterOptions() { return ['all', 'has', 'none']; }
  saveFilterLabel(value) { return ({ all:'全部存档', has:'有存档', none:'无存档' })[value] || '全部存档'; }
  saveFilterMatches(value, snapshotCount) {
    const count = Math.max(0, Number(snapshotCount) || 0);
    if (value === 'has') return count > 0;
    if (value === 'none') return count === 0;
    return true;
  }
  renderSaveFilter(host,onChange,items=[]) {
    const select=document.getElementById('saveFilter'),visible=Boolean(select&&!select.classList.contains('hidden'));
    let details=host.querySelector('[data-filter="saveFilter"]');
    if(!visible){this.hideDropdown(details);return;}
    const selected=select.value||'all',games=items.filter(item=>item.type==='game');
    if(!games.length&&selected==='all'){this.hideDropdown(details);return;}
    if(!details){details=document.createElement('details');details.className='filter-dropdown save-filter-dropdown';details.dataset.filter='saveFilter';details.innerHTML='<summary></summary><div class="filter-options" role="group" aria-label="按存档筛选"></div>';host.appendChild(details);}
    details.hidden=false;
    const hasSnapshots=games.some(item=>this.saveFilterMatches('has',snapshotsFor(item.id).length)),hasNoSnapshots=games.some(item=>this.saveFilterMatches('none',snapshotsFor(item.id).length)),available=['all',...(hasSnapshots||selected==='has'?['has']:[]),...(hasNoSnapshots||selected==='none'?['none']:[])];details.querySelector('summary').textContent='存档 · '+this.saveFilterLabel(selected);
    const menu=details.querySelector('.filter-options');menu.replaceChildren();
    for(const value of available){const button=document.createElement('button');button.type='button';button.className='filter-option'+(selected===value?' selected':'');button.dataset.value=value;button.textContent=this.saveFilterLabel(value);button.setAttribute('aria-pressed',String(selected===value));button.onclick=event=>{event.preventDefault();event.stopPropagation();select.value=value;details.open=false;onChange();};menu.appendChild(button);}
  }
  renderCompletion(host,onChange,items=[]) {
    let details=host.querySelector('[data-filter="completion"]');
    const hasDates=items.some(item=>/^\d{4}-\d{2}-\d{2}/.test(String(item.completedDate||'')));
    if(!hasDates&&!this.hasCompletion()){this.hideDropdown(details);return;}
    if(!details){details=document.createElement('details');details.className='filter-dropdown completion-filter';details.dataset.filter='completion';details.innerHTML='<summary></summary><div class="filter-options"><div class="date-mode"><button type="button" data-mode="range">日期区间</button><button type="button" data-mode="exact">特定日期</button></div><div class="date-range-fields"><label>从<input id="completedFrom" type="date"></label><label>至<input id="completedTo" type="date"></label></div><label class="date-exact-field">完成于<input id="completedOn" type="date"></label><small class="date-filter-error" role="status"></small></div>';host.appendChild(details);
      details.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{this.completion.mode=button.dataset.mode;onChange();});
      for(const [id,key]of [['completedFrom','from'],['completedTo','to'],['completedOn','on']])details.querySelector('#'+id).addEventListener('change',event=>{this.completion[key]=event.target.value;onChange();});
    }
    details.hidden=false;const c=this.completion;details.querySelector('summary').textContent=this.hasCompletion()?this.completionLabel():'完成日期 · 全部';
    details.querySelector('.date-range-fields').classList.toggle('hidden',c.mode!=='range');details.querySelector('.date-exact-field').classList.toggle('hidden',c.mode!=='exact');
    details.querySelectorAll('[data-mode]').forEach(button=>{button.classList.toggle('selected',button.dataset.mode===c.mode);button.setAttribute('aria-pressed',String(button.dataset.mode===c.mode));});
    for(const [id,key]of [['completedFrom','from'],['completedTo','to'],['completedOn','on']])details.querySelector('#'+id).value=c[key];
    details.querySelector('.date-filter-error').textContent=c.mode==='range'&&c.from&&c.to&&c.from>c.to?'结束日期应不早于开始日期':'';
  }
}
if (typeof module !== 'undefined') module.exports = ResourceFilters;
if (typeof window !== 'undefined') window.ResourceFilters = ResourceFilters;
