// Win32 child only. stdin accepts bounded numeric geometry in native client pixels.
// No media paths, shell commands, global hooks, or user-data access.
using System;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
class VideoHost {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateWindowEx(uint ex, string cls, string title, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr param);
  [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
  [DllImport("user32.dll")] static extern bool MoveWindow(IntPtr h, int x, int y, int w, int height, bool repaint);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int command);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h,out RECT rect);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(POINT point);
  [DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr h,uint flags);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out POINT point);
  [StructLayout(LayoutKind.Sequential)] struct POINT {public int x,y;}
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h,int attr,out RECT rect,int size);
  [StructLayout(LayoutKind.Sequential)] struct RECT {public int left,top,right,bottom;}
  [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int left,int top,int right,int bottom);
  [DllImport("user32.dll")] static extern int SetWindowRgn(IntPtr hwnd,IntPtr region,bool redraw);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr region);
  [DllImport("user32.dll")] static extern bool IsChild(IntPtr parent,IntPtr child);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] static extern IntPtr SetCursor(IntPtr cursor);
  [DllImport("user32.dll")] static extern IntPtr LoadCursor(IntPtr instance,IntPtr name);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern ushort RegisterClass(ref WINDOWCLASS cls);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr DefWindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll",EntryPoint="SetClassLongPtrW")] static extern IntPtr SetClassCursor(IntPtr h,int index,IntPtr value);
  delegate IntPtr WindowProc(IntPtr h,uint m,IntPtr w,IntPtr l);
  [DllImport("user32.dll")] static extern IntPtr SetFocus(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  static readonly WindowProc defaultWindowProc=DefWindowProc;
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct WINDOWCLASS{public uint style;public WindowProc procedure;public int classExtra,windowExtra;public IntPtr instance,icon,cursor,background;public string menu,name;}
  // This own input window replaces STATIC's hit-test-transparent host. No global cursor counter.
  [StructLayout(LayoutKind.Sequential)] struct MOUSETRACK{public int size;public uint flags;public IntPtr window;public uint hover;}
  [DllImport("user32.dll")] static extern bool TrackMouseEvent(ref MOUSETRACK track);
  [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint relation);
  class SurfaceCursor:NativeWindow {
    public int sets,moves,nonclient,leaves;
    readonly IntPtr parent,arrow=LoadCursor(IntPtr.Zero,new IntPtr(32512));
    int wheelRemainder;POINT last;long activity=System.Diagnostics.Stopwatch.GetTimestamp();bool hidden,tracking;
    public SurfaceCursor(IntPtr owner){
      parent=owner;
      var cls=new WINDOWCLASS{style=8,procedure=defaultWindowProc,cursor=arrow,name="YueDenVideoSurface"};
      if(RegisterClass(ref cls)==0)throw new InvalidOperationException("Cannot register video input window");
      var host=CreateWindowEx(0,"YueDenVideoSurface","YueDen video surface",0x46000000,0,0,1,1,owner,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
      if(host==IntPtr.Zero)throw new InvalidOperationException("Cannot create video input window");
      AssignHandle(host);GetCursorPos(out last);
    }
    bool Inside(){POINT p;if(!GetCursorPos(out p))return false;var host=Handle;var target=WindowFromPoint(p);return target==host||IsChild(host,target);}
    void Motion(){POINT p;if(GetCursorPos(out p)&&(p.x!=last.x||p.y!=last.y)){last=p;activity=System.Diagnostics.Stopwatch.GetTimestamp();}}
    void Apply(bool value){if(value==hidden)return;hidden=value;SetClassCursor(Handle,-12,hidden?IntPtr.Zero:arrow);if(Inside())SetCursor(hidden?IntPtr.Zero:arrow);}
    public void Restore(){activity=System.Diagnostics.Stopwatch.GetTimestamp();Apply(false);}
    public void Update(){
      Motion();bool eligible=immersive&&clipBottom==0&&IsWindowVisible(Handle)&&!IsIconic(parent)&&GetForegroundWindow()==parent&&Inside();
      if(!eligible)activity=System.Diagnostics.Stopwatch.GetTimestamp();
      Apply(eligible&&(System.Diagnostics.Stopwatch.GetTimestamp()-activity)*1000/System.Diagnostics.Stopwatch.Frequency>=1800);
    }
    protected override void WndProc(ref Message m){
      if(IsWindowEnabled(parent)&&IsWindowVisible(Handle)){
        if(m.Msg==0x201){SetFocus(Handle);Console.WriteLine("input Focus");}
        if(m.Msg==0x203){Console.WriteLine("input Toggle");m.Result=IntPtr.Zero;return;}
        if(m.Msg==0x20A&&(GetAsyncKeyState(0x11)&0x8000)==0){wheelRemainder+=(short)((m.WParam.ToInt64()>>16)&0xffff);while(Math.Abs(wheelRemainder)>=120){Console.WriteLine(wheelRemainder>0?"input WheelUp":"input WheelDown");wheelRemainder+=wheelRemainder>0?-120:120;}m.Result=IntPtr.Zero;return;}
        if(m.Msg==0x100&&(GetAsyncKeyState(0x11)&0x8000)==0&&(GetAsyncKeyState(0x12)&0x8000)==0&&(GetAsyncKeyState(0x10)&0x8000)==0&&(GetAsyncKeyState(0x5B)&0x8000)==0&&(GetAsyncKeyState(0x5C)&0x8000)==0){int key=m.WParam.ToInt32();string command=key==37?"Left":key==39?"Right":key==38?"Up":key==40?"Down":key==32?"Space":key==70?"F":key==27?"Escape":null;bool repeated=(m.LParam.ToInt64()&(1L<<30))!=0;if(command!=null&&(!repeated||(key>=37&&key<=40))){Console.WriteLine("input "+command);m.Result=IntPtr.Zero;return;}}
      }
      if(m.Msg==0x84){m.Result=new IntPtr(1);return;}
      if(m.Msg==0x20){sets++;Update();SetCursor(hidden?IntPtr.Zero:arrow);m.Result=new IntPtr(1);return;}
      if(m.Msg==0x200){moves++;if(!tracking){var track=new MOUSETRACK{size=Marshal.SizeOf(typeof(MOUSETRACK)),flags=2,window=Handle};tracking=TrackMouseEvent(ref track);}Motion();Update();}
      if(m.Msg==0xA0)nonclient++;
      if(m.Msg==0x2A3){leaves++;tracking=false;Restore();}
      if(m.Msg==0x8||(m.Msg==0x1C&&m.WParam==IntPtr.Zero))Restore();
      base.WndProc(ref m);
    }
  }
  static int clipBottom=0; static bool immersive=false; static string previousCursor="";
  static void Clip(IntPtr host){RECT r;if(!GetWindowRect(host,out r))return;var region=clipBottom>0?CreateRectRgn(0,0,r.right-r.left,Math.Max(1,r.bottom-r.top-clipBottom)):IntPtr.Zero;if(SetWindowRgn(host,region,true)==0&&region!=IntPtr.Zero)DeleteObject(region);}
  static readonly System.Collections.Generic.List<IntPtr> tracked=new System.Collections.Generic.List<IntPtr>();
  // Bounded backpressure: a burst is work to drain, not an end-of-input signal.
  static readonly BlockingCollection<string> commands = new BlockingCollection<string>(64);
  static volatile bool eof;
  static volatile bool stopping;
  static volatile int currentGesture;
  [STAThread] static int Main(string[] args) {
    long parentValue;
    if(args.Length<1 || args.Length>2 || !long.TryParse(args[0],out parentValue)) return 2;
    var parent = new IntPtr(parentValue); if(!IsWindow(parent)) return 3;
    System.IO.FileStream modifierFile=args.Length==2?new System.IO.FileStream(args[1],System.IO.FileMode.Open,System.IO.FileAccess.Write,System.IO.FileShare.ReadWrite):null;
    try { SetProcessDpiAwarenessContext(new IntPtr(-4)); } catch(EntryPointNotFoundException) { return 4; }
    // Owned input child, WS_CHILD | WS_CLIPSIBLINGS | WS_CLIPCHILDREN. Hidden until sized.
    var surfaceCursor=new SurfaceCursor(parent);var host=surfaceCursor.Handle;
    if(host==IntPtr.Zero) return 5;
    Console.WriteLine("{\"hwnd\":\""+host.ToInt64()+"\",\"parent\":\""+GetParent(host).ToInt64()+"\"}");
    new Thread(()=>{try{string line;while((line=Console.ReadLine())!=null){if(line.Length>128)break;commands.Add(line);}}finally{eof=true;}}){IsBackground=true}.Start();
    var timer=new System.Windows.Forms.Timer();timer.Interval=15;
    int previousAlt=-1,previousDown=-1;string previousFrames="",previousGeometry="";
    var modifierThread=new Thread(()=>{bool wasDown=false;int gesture=0;POINT cursor=new POINT();RECT origin=new RECT();IntPtr active=IntPtr.Zero;while(!stopping){bool isDown=(GetAsyncKeyState(1)&0x8000)!=0;if(isDown&&!wasDown){gesture++;currentGesture=gesture;GetCursorPos(out cursor);active=GetAncestor(WindowFromPoint(cursor),2);GetWindowRect(active,out origin);}wasDown=isDown;if(modifierFile!=null){var bytes=new byte[40];bytes[0]=(byte)(((GetAsyncKeyState(0x12)&0x8000)!=0)?1:0);bytes[1]=(byte)(isDown?1:0);Buffer.BlockCopy(BitConverter.GetBytes(cursor.x),0,bytes,4,4);Buffer.BlockCopy(BitConverter.GetBytes(cursor.y),0,bytes,8,4);Buffer.BlockCopy(BitConverter.GetBytes(origin.left),0,bytes,12,4);Buffer.BlockCopy(BitConverter.GetBytes(origin.top),0,bytes,16,4);Buffer.BlockCopy(BitConverter.GetBytes(gesture),0,bytes,20,4);Buffer.BlockCopy(BitConverter.GetBytes(active.ToInt64()),0,bytes,24,8);modifierFile.Position=0;modifierFile.Write(bytes,0,bytes.Length);modifierFile.Flush();}Thread.Sleep(10);}}){IsBackground=true};modifierThread.Start();
    timer.Tick+=(sender,e)=>{
      if(eof || !IsWindow(parent)){Application.ExitThread();return;}
      surfaceCursor.Update();
      int alt=(GetAsyncKeyState(0x12)&0x8000)!=0?1:0,down=(GetAsyncKeyState(1)&0x8000)!=0?1:0;
      if(alt!=previousAlt||down!=previousDown){Console.WriteLine("pointer "+alt+" "+down);previousAlt=alt;previousDown=down;}
      if(immersive){POINT point;RECT rect;if(GetCursorPos(out point)&&GetWindowRect(parent,out rect)&&GetForegroundWindow()==parent){string cursor="cursor "+(point.x-rect.left)+" "+(point.y-rect.top);if(cursor!=previousCursor){Console.WriteLine(cursor);previousCursor=cursor;if(Environment.GetEnvironmentVariable("YUE_CURSOR_TRACE")=="1")Console.WriteLine("cursor-state host="+host+" target="+WindowFromPoint(point)+" set="+surfaceCursor.sets+" move="+surfaceCursor.moves+" nc="+surfaceCursor.nonclient+" leave="+surfaceCursor.leaves);}}}
      string frames="";foreach(var window in tracked){RECT rect,visible;if(IsWindow(window)&&GetWindowRect(window,out rect)&&DwmGetWindowAttribute(window,9,out visible,Marshal.SizeOf(typeof(RECT)))==0)frames+="frame "+window.ToInt64()+" "+(visible.left-rect.left)+" "+(visible.top-rect.top)+" "+(rect.right-visible.right)+" "+(rect.bottom-visible.bottom)+" "+(rect.right-rect.left)+" "+(rect.bottom-rect.top)+" "+rect.left+" "+rect.top+"\n";}
      if(frames!=previousFrames){Console.Write(frames);previousFrames=frames;}
      string line;int budget=64;while(budget-->0&&commands.TryTake(out line)){
        if(line.StartsWith("audio-brand ")){uint pid;if(uint.TryParse(line.Substring(12),out pid)&&pid>0){try{AudioBrand.Apply(pid);}catch(Exception error){Console.WriteLine("audio-brand-error "+error.Message.Replace("\n"," "));}}continue;}
        if(line.StartsWith("clip ")){int value;if(int.TryParse(line.Substring(5),out value)&&value>=0&&value<=4096){if(clipBottom!=value){clipBottom=value;Clip(host);}}continue;}
        if(line.StartsWith("immersive ")){immersive=line=="immersive 1";previousCursor="";continue;}
        if(line.StartsWith("track ")){tracked.RemoveAll(trackedWindow=>!IsWindow(trackedWindow));long value;if(long.TryParse(line.Substring(6),out value)&&tracked.Count<5&&!tracked.Contains(new IntPtr(value)))tracked.Add(new IntPtr(value));continue;}
        if(line.StartsWith("measure ")){var fields=line.Split(' ');long handle;int id;RECT rect;if(fields.Length==3&&int.TryParse(fields[1],out id)&&long.TryParse(fields[2],out handle)&&tracked.Contains(new IntPtr(handle))&&DwmGetWindowAttribute(new IntPtr(handle),9,out rect,Marshal.SizeOf(typeof(RECT)))==0)Console.WriteLine("measured "+id+" "+rect.left+" "+rect.top+" "+(rect.right-rect.left)+" "+(rect.bottom-rect.top));continue;}
        if(line.StartsWith("place ")){var fields=line.Split(' ');long handle;int id,place_x,place_y,place_w,place_h;bool ok=false;if(fields.Length==7&&int.TryParse(fields[1],out id)&&long.TryParse(fields[2],out handle)&&int.TryParse(fields[3],out place_x)&&int.TryParse(fields[4],out place_y)&&int.TryParse(fields[5],out place_w)&&int.TryParse(fields[6],out place_h)&&place_w>0&&place_h>0&&tracked.Contains(new IntPtr(handle))){RECT outer,visible;var target=new IntPtr(handle);if(GetWindowRect(target,out outer)&&DwmGetWindowAttribute(target,9,out visible,Marshal.SizeOf(typeof(RECT)))==0){int left=visible.left-outer.left,top=visible.top-outer.top,right=outer.right-visible.right,bottom=outer.bottom-visible.bottom;ok=SetWindowPos(target,IntPtr.Zero,place_x-left,place_y-top,place_w+left+right,place_h+top+bottom,0x14u);}Console.WriteLine("placed "+id+" "+(ok?"1":"0"));}continue;}
        bool resize=line.StartsWith("resizemove ");
        if(resize||line.StartsWith("dragmove ")){var fields=line.Split(' ');int gesture;if(fields.Length!=7||!int.TryParse(fields[1],out gesture)||gesture!=currentGesture||(GetAsyncKeyState(1)&0x8000)==0)continue;line="move "+string.Join(" ",fields,2,5);}
        if(line.StartsWith("move ")){var move=line.Split(' ');long handle;int mx,my,mw,mh;if(move.Length==6&&long.TryParse(move[1],out handle)&&int.TryParse(move[2],out mx)&&int.TryParse(move[3],out my)&&int.TryParse(move[4],out mw)&&int.TryParse(move[5],out mh)&&mw>0&&mh>0&&tracked.Contains(new IntPtr(handle)))SetWindowPos(new IntPtr(handle),IntPtr.Zero,mx,my,mw,mh,resize?0x14u:0x15u);continue;}
        if(line=="close"){Application.ExitThread();return;}
        if(line=="hide"){ShowWindow(host,0);Console.WriteLine("hidden");continue;}
        var parts=line.Split(' ');int x,y,w,h;
        if(parts.Length!=4 || !int.TryParse(parts[0],out x) || !int.TryParse(parts[1],out y) || !int.TryParse(parts[2],out w) || !int.TryParse(parts[3],out h) || x<0 || y<0 || w<1 || h<1 || x>32768 || y>32768 || w>32768 || h>32768){Console.WriteLine("invalid");continue;}
        // Chromium may reorder/recreate its own client children on activation/fullscreen.
        // Keep only this bounded video child above them, without activating the window.
        // HWND_TOP is relative to sibling children, NOT a top-level/topmost mpv window.
        if(line==previousGeometry&&IsWindowVisible(host)&&GetWindow(host,3)==IntPtr.Zero){Console.WriteLine("sized");continue;}
        previousGeometry=line;
        if(!SetWindowPos(host,IntPtr.Zero,x,y,w,h,0x50)){Console.WriteLine("failed");continue;}
        Clip(host);Console.WriteLine("sized");
      }
    };
    timer.Start();Application.Run();timer.Stop();timer.Dispose();surfaceCursor.Restore();stopping=true;modifierThread.Join(200);if(modifierFile!=null)modifierFile.Dispose();DestroyWindow(host);return 0;
  }
}
