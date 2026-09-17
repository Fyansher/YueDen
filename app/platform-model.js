/* Platform identity is independent of metadata/score provenance. Logos identify
   storefronts only; no affiliation or endorsement is implied. */
(function(root){
  const labels={steam:'Steam',ns:'Nintendo Switch',ps:'PlayStation',epic:'Epic Games',dlsite:'DLsite',xbox:'Xbox',pc:'PC'};
  const paths={
    steam:'<circle cx="17" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="17" cy="7" r="2.3"/><circle cx="7" cy="17" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M0 12l8 3 3 3-4 1-7-3zm9 1 4-6 4 4-6 5z"/>',
    ns:'<path d="M10 2H7a5 5 0 0 0-5 5v10a5 5 0 0 0 5 5h3V2zm-2 2v16H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3h1zM14 2h3a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5h-3V2z"/><circle cx="6" cy="8" r="1.5"/><circle cx="18" cy="15" r="2" fill="var(--platform-bg)"/>',
    ps:'<path d="M9 2v18l4 1.3V6.2c0-.9.4-1.3 1-1.1.8.2 1 1 1 2v6c4 1.6 5-.9 5-4 0-3.5-1.6-5.1-5.5-6.2L9 2zM7.5 15l-4 1.5c-2.8 1-3.5 2.3-1 3.1 1.6.6 3.4.7 5 .3v-2l-1.7.5c-.7.2-1.1-.1-.4-.4l2.1-.8V15zm7 1.7v2l4-1.3c.8-.3 1.4 0 .6.4l-4.6 1.7v2L21 19c3.2-1.3 3.4-2.5.8-3.3-1.8-.5-4.4-.4-7.3 1z"/>',
    epic:'<path d="M4 1h16a1 1 0 0 1 1 1v17l-9 4-9-4V2a1 1 0 0 1 1-1z"/><path d="M6 6h3v1H7v1h2v1H7v1h2v1H6zm4 0h2a2 2 0 0 1 0 4h-1v1h-1zm1 1v2h1V7zm4-1h1v5h-1zm3 0h2v1h-2v3h2v1h-2a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zM7 14h10v1H7zm2 3h6v1H9z" fill="var(--platform-bg)"/>',
    dlsite:'<path d="M2 4h8c5 0 8 3 8 8s-3 8-8 8H2zm4 4v8h4c3 0 4-2 4-4s-1-4-4-4z"/><path d="M18 3h4v18h-4z"/>',
    xbox:'<circle cx="12" cy="12" r="11"/><path d="M5 3q7 1 14 17M19 3Q12 4 5 20" stroke="var(--platform-bg)" stroke-width="3" fill="none"/>',
    pc:'<rect x="2" y="3" width="20" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 17h4v3h4v2H6v-2h4z"/>'
  };
  function normalize(value){const s=String(value||'').toLowerCase();if(/steam/.test(s))return 'steam';if(/switch|nintendo|^ns$|任天堂/.test(s))return 'ns';if(/playstation|^ps[1-5pⅴv]?|索尼/.test(s))return 'ps';if(/epic/.test(s))return 'epic';if(/dlsite/.test(s))return 'dlsite';if(/xbox/.test(s))return 'xbox';if(/windows|^pc$|linux|mac/.test(s))return 'pc';return '';}
  function detect(item={}){const explicit=[...(Array.isArray(item.platforms)?item.platforms:[]),item.gamePlatform].map(normalize).filter(Boolean);if(explicit.length||item.platformsManual)return [...new Set(explicit)];const source=String(item.storeUrl||'');const inferred=normalize(source);return inferred?[inferred]:item.steamAppId?['steam']:[];}
  function icons(item,limit=4){const keys=detect(item);return keys.slice(0,limit).map(key=>'<span class="platform-logo" data-platform="'+key+'" role="img" aria-label="'+labels[key]+'" title="'+labels[key]+'"><svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">'+paths[key]+'</svg></span>').join('')+(keys.length>limit?'<span class="platform-more" title="'+keys.slice(limit).map(key=>labels[key]).join('、')+'">+'+(keys.length-limit)+'</span>':'');}
  const api={labels,normalize,detect,icons};if(typeof module!=='undefined')module.exports=api;if(root)root.PlatformModel=api;
})(typeof window!=='undefined'?window:null);
