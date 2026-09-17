/* Shared preview lifecycle. Adapters keep their own resource/track models. */
(function(root){
 function state(row){if(row.metadataInvalidated||row.invalidated)return 'stale';if(row.metadataApplied||row.metadataPrepared&&row.resolvedMetadata||row.prepared||row.item?._previewPrepared)return 'ready';if(row.metadataBundle||row.candidates?.length||row.item?._previewCandidates?.length)return 'candidates';if(row.metadataChecked||row.item?._previewMatched||row.item?._previewError)return 'checked';return 'pending';}
 function invalidate(row){row.metadataInvalidated=true;for(const key of ['metadataBundle','resolvedMetadata','metadataPrepared','metadataChecked'])delete row[key];row.prepared=false;row.candidates=[];}
 async function once(row,work){if(row._metadataWork)return row._metadataWork;const promise=Promise.resolve().then(work);row._metadataWork=promise;try{return await promise;}finally{if(row._metadataWork===promise)delete row._metadataWork;}}
 const api={state,invalidate,once};if(typeof module!=='undefined')module.exports=api;else root.ImportSessionModel=api;
})(typeof window==='undefined'?globalThis:window);
