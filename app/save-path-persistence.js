'use strict';

const path=require('node:path');

function create({loadLibrary,normaliseItem,writeJson,dataFile}){
  return function persistSavePaths(itemId,paths){
    const library=loadLibrary(),updated=library.items.map(item=>item.id===itemId?normaliseItem({...item,savePaths:[...new Set((paths||[]).filter(value=>typeof value==='string'&&path.isAbsolute(value)))],updatedAt:new Date().toISOString()}):item);
    if(!updated.some(item=>item.id===itemId))return {ok:false,message:'游戏条目不存在'};
    const next={...library,...require('./library-relations').fields({...library,items:updated},normaliseItem),schemaVersion:4,items:updated,categories:Array.isArray(library.categories)?library.categories:[]};
    writeJson(dataFile(),next);
    return {ok:true,item:updated.find(item=>item.id===itemId)};
  };
}

module.exports={create};
