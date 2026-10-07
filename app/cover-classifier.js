(function(root){
  function classify(width,height){
    const w=Number(width),h=Number(height);if(!(w>0&&h>0))return '';
    const ratio=w/h;if(ratio>1.08)return 'landscape';if(ratio<1/1.08)return 'portrait';return 'square';
  }
  function orientation(item){
    const known=['portrait','landscape','square'].includes(item?.coverOrientation)?item.coverOrientation:'';
    return classify(item?.coverDimensions?.width,item?.coverDimensions?.height)||known;
  }
  const api={classify,orientation};
  if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CoverClassifier=api;
})(typeof globalThis!=='undefined'?globalThis:this);
