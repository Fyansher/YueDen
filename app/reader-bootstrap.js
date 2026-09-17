window.UNIFIED_READER_WINDOW=true;
const native=window.unifiedAPI,$=id=>document.getElementById(id),all=s=>[...document.querySelectorAll(s)];let settings={appearance:{}};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function showToast(text){const el=$('readerMessage');if(el){el.textContent=text;el.classList.remove('hidden');}}
function readerAppearance(appearance={}){settings.appearance=appearance;YueDenAppearance.apply(appearance);}
