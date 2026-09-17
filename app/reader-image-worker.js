/* CPU work off the UI thread; analysis/processing bounded to 6 megapixels. */
onmessage=async({data})=>{
 const {id,bitmap,options}=data;
 try{
  const scale=Math.min(1,Math.sqrt(6000000/(bitmap.width*bitmap.height))),w=Math.max(1,Math.round(bitmap.width*scale)),h=Math.max(1,Math.round(bitmap.height*scale)),canvas=new OffscreenCanvas(w,h),ctx=canvas.getContext('2d',{willReadFrequently:true});
  ctx.fillStyle='white';ctx.fillRect(0,0,w,h);ctx.filter=options.descreen?'blur(0.65px)':'none';ctx.drawImage(bitmap,0,0,w,h);bitmap.close();let pixels=ctx.getImageData(0,0,w,h),left=0,right=w-1,top=0,bottom=h-1;
  if(options.crop){const threshold=options.crop==='smart'?238:250,ink=(x,y)=>{const i=(y*w+x)*4;return pixels.data[i]<threshold||pixels.data[i+1]<threshold||pixels.data[i+2]<threshold;},row=y=>{let n=0;for(let x=0;x<w;x+=2)if(ink(x,y)&&++n>2)return true;return false;},col=x=>{let n=0;for(let y=top;y<=bottom;y+=2)if(ink(x,y)&&++n>2)return true;return false;};
   while(top<h*.3&&!row(top))top++;while(bottom>h*.7&&!row(bottom))bottom--;while(left<w*.3&&!col(left))left++;while(right>w*.7&&!col(right))right--;left=Math.max(0,left-3);right=Math.min(w-1,right+3);top=Math.max(0,top-3);bottom=Math.min(h-1,bottom+3);
  }
  if(options.sharp){const src=pixels.data,dst=new Uint8ClampedArray(src),amount=.35;for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=(y*w+x)*4;for(let c=0;c<3;c++)dst[i+c]=src[i+c]*(1+4*amount)-amount*(src[i+c-4]+src[i+c+4]+src[i+c-w*4]+src[i+c+w*4]);}pixels=new ImageData(dst,w,h);ctx.putImageData(pixels,0,0);}
  if(options.half==='left')right=Math.floor((left+right)/2);if(options.half==='right')left=Math.ceil((left+right)/2);
  const output=new OffscreenCanvas(right-left+1,bottom-top+1);output.getContext('2d').drawImage(canvas,left,top,output.width,output.height,0,0,output.width,output.height);
  postMessage({id,blob:await output.convertToBlob({type:'image/png'})});
 }catch(e){bitmap?.close();postMessage({id,error:e.message});}
};
