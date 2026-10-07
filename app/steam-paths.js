const parts=value=>String(value||'').replace(/[\\/]+$/,'').split(/[\\/]+/).filter(Boolean);
function isSteamCommonDirectory(value){const dirs=parts(value);return dirs.length>=2&&dirs[dirs.length-1].toLowerCase()==='common'&&dirs[dirs.length-2].toLowerCase()==='steamapps';}
function isSteamCommonGameDirectory(value){const dirs=parts(value);return dirs.length>=3&&dirs[dirs.length-2].toLowerCase()==='common'&&dirs[dirs.length-3].toLowerCase()==='steamapps';}
module.exports={isSteamCommonDirectory,isSteamCommonGameDirectory};
