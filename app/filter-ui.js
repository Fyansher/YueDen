/* Shared selection state for the library and the tag-management page. */
class ResourceFilters {
  constructor() {
    this.values = Object.fromEntries(['statusFilter', 'genreFilter', 'categoryFilter', 'yearFilter', 'ratingFilter'].map(id => [id, new Set()]));
    this.labels = { statusFilter: '状态', genreFilter: '类型标签', categoryFilter: '分类', yearFilter: '发售年份', ratingFilter: '个人评分' };
    this.completion = { mode:'range', from:'', to:'', on:'' };
  }
  selected(id) { return [...(this.values[id] || [])]; }
  toggle(id, value) { const set = this.values[id]; if (!set || value === 'all') return; const wasSelected = set.has(value); if (id === 'statusFilter') set.clear(); wasSelected ? set.delete(value) : set.add(value); }
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
    if (!ignore.includes('statusFilter') && this.values.statusFilter.size && !this.selected('statusFilter').some(value => value.startsWith('phase:') ? StatusModel.stage(item.status) === value.slice(6) : item.status === value)) return false;
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
      const label = id === 'ratingFilter' ? (value === 'unrated' ? '未评分' : value + ' 星') : id === 'statusFilter' && value.startsWith('phase:') ? StatusModel.stages[value.slice(6)] : value;
      button.textContent = label + ' ×'; button.setAttribute('aria-label', '取消' + this.labels[id] + '：' + label);
      button.dataset.filter = id; button.dataset.value = value;
      button.addEventListener('click', () => { this.values[id].delete(value); change(); }); host.appendChild(button);
    }));
  }
  render(items, onChange) {
    const root = document.getElementById('filters'); if (!root) return;
    let host = document.getElementById('multiFilterControls');
    if (!host) { host = document.createElement('div'); host.id = 'multiFilterControls'; root.prepend(host); }
    let chips = document.getElementById('activeFilterChips');
    if (!chips) { chips = document.createElement('div'); chips.id = 'activeFilterChips'; chips.className = 'selected-filter-chips'; root.prepend(chips); }
    this.chips(chips, onChange);
    const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'zh'));
    const options = {
      statusFilter: unique(items.filter(item=>item.type!=='audio').map(item => item.status)),
      genreFilter: unique(items.flatMap(item => item.genres || [])),
      categoryFilter: unique(items.flatMap(item => item.categories || [])),
      yearFilter: unique(items.map(item => String(item.releaseDate || '').slice(0, 4)).filter(year => /^\d{4}$/.test(year))).reverse(),
      ratingFilter: ['unrated', ...Array.from({length:10},(_,i)=>String((i+1)/2))]
    };
    Object.entries(options).forEach(([id, choices]) => {
      let details = host.querySelector('[data-filter="' + id + '"]');
      if (!details) {
        details = document.createElement('details'); details.className = 'filter-dropdown'; details.dataset.filter = id;
        const summary = document.createElement('summary'); details.appendChild(summary);
        const menu = document.createElement('div'); menu.className = 'filter-options'; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', this.labels[id]); details.appendChild(menu); host.appendChild(details);
      }
      details.querySelector('summary').textContent = this.labels[id] + (this.values[id].size ? ' · ' + this.values[id].size + ' 项' : ' · 全部');
      const menu = details.querySelector('.filter-options'); const focused = menu.contains(document.activeElement) ? document.activeElement.dataset.value : null; const retained = new Map([...menu.querySelectorAll('button[data-value]')].map(node => [node.dataset.value,node])); menu.querySelectorAll('p').forEach(node=>node.remove()); const needed=new Set([...choices,...this.selected(id)]); for(const [value,node]of retained)if(!needed.has(value))node.remove();
      if (!choices.length) { const empty = document.createElement('p'); empty.textContent = '暂无可选项'; menu.appendChild(empty); }
      unique([...choices, ...this.selected(id)]).forEach(value => {
        const button = retained.get(value) || document.createElement('button'); button.type = 'button'; button.dataset.value = value;
        const selected = this.values[id].has(value); button.className = 'filter-option' + (selected ? ' selected' : '');
        button.setAttribute('aria-pressed', String(selected)); button.textContent = id === 'ratingFilter' ? (value === 'unrated' ? '未评分' : value + ' 星') : id === 'statusFilter' && value.startsWith('phase:') ? StatusModel.stages[value.slice(6)] : value;
        button.onclick = event => { event.preventDefault(); event.stopPropagation(); this.toggle(id, value); onChange(); }; if(button.parentElement!==menu)menu.appendChild(button);
      });
      if (focused) [...menu.children].find(node => node.dataset.value === focused)?.focus({ preventScroll: true });
    });
    this.renderCompletion(host,onChange);
    if(!host.dataset.exclusiveMenus){host.dataset.exclusiveMenus='1';host.addEventListener('click',event=>{const summary=event.target.closest('summary');if(!summary)return;const current=summary.parentElement;host.querySelectorAll('details').forEach(menu=>{if(menu!==current)menu.open=false;});});document.addEventListener('pointerdown',event=>{if(!host.contains(event.target))host.querySelectorAll('details').forEach(menu=>menu.open=false);});}
  }
  renderCompletion(host,onChange) {
    let details=host.querySelector('[data-filter="completion"]');
    if(!details){details=document.createElement('details');details.className='filter-dropdown completion-filter';details.dataset.filter='completion';details.innerHTML='<summary></summary><div class="filter-options"><div class="date-mode"><button type="button" data-mode="range">日期区间</button><button type="button" data-mode="exact">特定日期</button></div><div class="date-range-fields"><label>从<input id="completedFrom" type="date"></label><label>至<input id="completedTo" type="date"></label></div><label class="date-exact-field">完成于<input id="completedOn" type="date"></label><small class="date-filter-error" role="status"></small></div>';host.appendChild(details);
      details.querySelectorAll('[data-mode]').forEach(button=>button.onclick=()=>{this.completion.mode=button.dataset.mode;onChange();});
      for(const [id,key]of [['completedFrom','from'],['completedTo','to'],['completedOn','on']])details.querySelector('#'+id).addEventListener('change',event=>{this.completion[key]=event.target.value;onChange();});
    }
    const c=this.completion;details.querySelector('summary').textContent=this.hasCompletion()?this.completionLabel():'完成日期 · 全部';
    details.querySelector('.date-range-fields').classList.toggle('hidden',c.mode!=='range');details.querySelector('.date-exact-field').classList.toggle('hidden',c.mode!=='exact');
    details.querySelectorAll('[data-mode]').forEach(button=>{button.classList.toggle('selected',button.dataset.mode===c.mode);button.setAttribute('aria-pressed',String(button.dataset.mode===c.mode));});
    for(const [id,key]of [['completedFrom','from'],['completedTo','to'],['completedOn','on']])details.querySelector('#'+id).value=c[key];
    details.querySelector('.date-filter-error').textContent=c.mode==='range'&&c.from&&c.to&&c.from>c.to?'结束日期应不早于开始日期':'';
  }
}
if (typeof module !== 'undefined') module.exports = ResourceFilters;
if (typeof window !== 'undefined') window.ResourceFilters = ResourceFilters;
