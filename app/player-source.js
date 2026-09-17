/* Persist stable library references, never stream URLs or decrypted credentials. */
const prefix='yueden-track:';
function reference(item,track){return prefix+JSON.stringify([String(item),String(track)]);}
function parse(value){if(typeof value!=='string'||!value.startsWith(prefix))return null;try{const ids=JSON.parse(value.slice(prefix.length));return Array.isArray(ids)&&ids.length===2&&ids.every(x=>typeof x==='string'&&x.length>0&&x.length<=150)?ids:null;}catch{return null;}}
module.exports={reference,parse};
