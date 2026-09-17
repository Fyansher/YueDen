import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
export class NativeSurface {
  onNative:(line:string)=>void=()=>{};
  onExit:()=>void=()=>{};
  private child: ChildProcessWithoutNullStreams | null = null;
  private modifierFd:number|null=null;
  private measurementId=0;
  private measurements=new Map<number,{resolve:(value:number[])=>void,reject:(error:Error)=>void}>();
  private placementId=0;
  private placements=new Map<number,{resolve:()=>void,reject:(error:Error)=>void}>();
  private rejectPlacements(){for(const p of this.measurements.values())p.reject(Error("原生窗口已关闭"));this.measurements.clear();for(const p of this.placements.values())p.reject(Error("原生窗口已关闭"));this.placements.clear();}
  async open(executable: string, parent: string): Promise<string> {
    if (this.child) throw Error('原生视频区域已创建');
    const directory=fs.mkdtempSync(path.join(os.tmpdir(),'um-player-native-')),file=path.join(directory,'modifiers.bin');fs.writeFileSync(file,Buffer.alloc(40),{flag:'wx'});this.modifierFd=fs.openSync(file,'r');
    const child = spawn(executable,[parent,file],{windowsHide:true,shell:false,stdio:'pipe'}); this.child=child;
    child.once('exit',()=>{this.rejectPlacements();if(this.modifierFd!==null){fs.closeSync(this.modifierFd);this.modifierFd=null}try{fs.unlinkSync(file);fs.rmdirSync(directory)}catch{}if(this.child===child){this.child=null;this.onExit()}});
    return new Promise((resolve,reject)=>{
      const lines=createInterface({input:child.stdout});
      const timer=setTimeout(()=>{child.kill();reject(Error('创建视频子窗口超时'));},5000);
      child.once('error',error=>{clearTimeout(timer);reject(error)});
      child.once('exit',()=>{clearTimeout(timer);reject(Error('视频子窗口已退出'));lines.close()});
      lines.once('line',line=>{clearTimeout(timer);try{const value=JSON.parse(line);if(value.parent!==parent||!/^\d+$/.test(value.hwnd)||value.hwnd===parent)throw Error('原生子窗口身份错误');resolve(value.hwnd)}catch(error){child.kill();reject(error)}});
      // Keep consuming confirmations so stdout cannot fill during resize.
      lines.on('line',line=>{if(line.startsWith('measured ')){const values=line.split(' ').slice(1).map(Number);if(values.length===5&&values.every(Number.isFinite))this.measurements.get(values[0]!)?.resolve(values.slice(1));}if(line.startsWith('placed ')){const [,id,ok]=line.split(' '),pending=this.placements.get(Number(id));if(ok==='1')pending?.resolve();else pending?.reject(Error('恢复窗口位置失败'));}if(line.startsWith('pointer ')||line.startsWith('frame ')||line.startsWith('cursor ')||line.startsWith('input '))this.onNative(line)});child.stderr.resume();child.stdin.on('error',()=>{});
    });
  }
  bounds(x:number,y:number,w:number,h:number):void {
    if(![x,y,w,h].every(Number.isFinite)||x<0||y<0||w<1||h<1||Math.max(x,y,w,h)>32768)throw Error('视频区域无效');
    this.child?.stdin.write([x,y,w,h].map(Math.round).join(' ')+'\n');
  }
  immersive(value:boolean):void{this.child?.stdin.write('immersive '+(value?1:0)+'\n')}
  clipBottom(value:number):void{if(Number.isFinite(value)&&value>=0&&value<=4096)this.child?.stdin.write('clip '+Math.round(value)+'\n')}
  brandAudio(pid:number):void{if(Number.isSafeInteger(pid)&&pid>0)this.child?.stdin.write('audio-brand '+pid+'\n')}
  hide():void{this.child?.stdin.write('hide\n')}
  track(handle:string):void{if(/^\d+$/.test(handle))this.child?.stdin.write('track '+handle+'\n')}
  move(handle:string,x:number,y:number,width:number,height:number):void{if(/^\d+$/.test(handle)&&[x,y,width,height].every(Number.isFinite))this.child?.stdin.write(`move ${handle} ${Math.round(x)} ${Math.round(y)} ${Math.round(width)} ${Math.round(height)}\n`)}
  measure(handle:string):Promise<number[]>{
    if(!this.child||!/^\d+$/.test(handle))return Promise.reject(Error('窗口句柄无效'));const id=++this.measurementId;
    return new Promise((resolve,reject)=>{const finish=(error:Error|null,value:number[]=[])=>{clearTimeout(timer);this.measurements.delete(id);error?reject(error):resolve(value);},timer=setTimeout(()=>finish(Error('读取窗口边界超时')),5000);this.measurements.set(id,{resolve:value=>finish(null,value),reject:error=>finish(error)});this.child!.stdin.write('measure '+id+' '+handle+'\n');});
  }
  place(handle:string,x:number,y:number,width:number,height:number):Promise<void>{
    if(!this.child||!/^\d+$/.test(handle)||![x,y,width,height].every(Number.isFinite)||width<1||height<1)return Promise.reject(Error('恢复窗口边界无效'));
    const id=++this.placementId;return new Promise((resolve,reject)=>{const finish=(error?:Error)=>{clearTimeout(timer);this.placements.delete(id);error?reject(error):resolve();},timer=setTimeout(()=>finish(Error('恢复窗口位置超时')),5000);this.placements.set(id,{resolve:()=>finish(),reject:finish});this.child!.stdin.write(['place',id,handle,...[x,y,width,height].map(Math.round)].join(' ')+'\n');});
  }
  dragMove(gesture:number,handle:string,x:number,y:number,width:number,height:number):void{if(Number.isSafeInteger(gesture)&&/^\d+$/.test(handle)&&[x,y,width,height].every(Number.isFinite))this.child?.stdin.write(`dragmove ${gesture} ${handle} ${Math.round(x)} ${Math.round(y)} ${Math.round(width)} ${Math.round(height)}\n`)}
  resize(gesture:number,handle:string,x:number,y:number,width:number,height:number):void{if(Number.isSafeInteger(gesture)&&/^\d+$/.test(handle)&&[x,y,width,height].every(Number.isFinite))this.child?.stdin.write(['resizemove',gesture,handle,...[x,y,width,height].map(Math.round)].join(' ')+'\n')}
  modifiers(){const bytes=Buffer.alloc(40);if(this.modifierFd!==null)fs.readSync(this.modifierFd,bytes,0,40,0);return {alt:bytes[0]===1,down:bytes[1]===1,cursor:{x:bytes.readInt32LE(4),y:bytes.readInt32LE(8)},origin:{x:bytes.readInt32LE(12),y:bytes.readInt32LE(16)},gesture:bytes.readInt32LE(20),handle:bytes.readBigInt64LE(24).toString()}}
  close():void{this.rejectPlacements();this.child?.stdin.end('close\n');this.child=null}
}
