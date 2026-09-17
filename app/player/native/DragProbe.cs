// Test-only native title-bar gesture on two explicitly supplied test HWNDs.
using System;using System.Threading;using System.Runtime.InteropServices;
class DragProbe {
 [StructLayout(LayoutKind.Sequential)]struct R{public int l,t,r,b;}
 [StructLayout(LayoutKind.Sequential)]struct P{public int x,y;}
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr h,int a,out R r,int n);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(P p);
 [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]static extern bool GetCursorPos(out P p);
 [DllImport("user32.dll")]static extern void mouse_event(uint flags,uint x,uint y,uint data,UIntPtr extra);
 [DllImport("user32.dll")]static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr p);
 [DllImport("user32.dll")]static extern IntPtr SendMessageTimeout(IntPtr h,uint m,IntPtr w,IntPtr l,uint flags,uint timeout,out IntPtr result);
 [DllImport("user32.dll")]static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")]static extern short GetAsyncKeyState(int key);
 static string Probe(IntPtr source,int x,int y){P p=new P{x=x,y=y};var hit=WindowFromPoint(p);IntPtr code;SendMessageTimeout(hit,0x84,IntPtr.Zero,new IntPtr((y<<16)|(x&65535)),2,500,out code);IntPtr parentCode;SendMessageTimeout(source,0x84,IntPtr.Zero,new IntPtr((y<<16)|(x&65535)),2,500,out parentCode);R r;GetWindowRect(source,out r);return "\"parentHitTest\":"+parentCode.ToInt64()+",\"hwnd\":"+hit.ToInt64()+",\"hitTest\":"+code.ToInt64()+",\"cursor\":["+x+","+y+"],\"rect\":["+r.l+","+r.t+","+r.r+","+r.b+"],\"dpi\":"+GetDpiForWindow(source);}
 [DllImport("user32.dll")]static extern int GetSystemMetrics(int index);
 static R Frame(IntPtr h){R r;if(DwmGetWindowAttribute(h,9,out r,Marshal.SizeOf(typeof(R)))!=0)GetWindowRect(h,out r);return r;}
 static int Gap(R a,R b,string direction){return direction=="right"?a.l-b.r:direction=="top"?b.t-a.b:direction=="bottom"?a.t-b.b:b.l-a.r;}
 [StructLayout(LayoutKind.Sequential)]struct G{public int size,flags;public IntPtr active,focus,capture,menu,move,caret;public R rect;}
 [DllImport("user32.dll")]static extern bool GetGUIThreadInfo(uint thread,ref G info);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr window,IntPtr process);
 static void Released(IntPtr source){var g=new G();g.size=Marshal.SizeOf(typeof(G));uint thread=GetWindowThreadProcessId(source,IntPtr.Zero);for(int i=0;i<100;i++){if(GetGUIThreadInfo(thread,ref g)&&g.capture==IntPtr.Zero&&g.move==IntPtr.Zero)return;Thread.Sleep(10);}throw new Exception("Test gesture did not release capture");}
 static int Main(string[] args){if(args.Length<2||args.Length>3)return 2;string direction=args.Length==3?args[2]:"left";bool vertical=direction=="top"||direction=="bottom";int away=direction=="right"||direction=="bottom"?45:-45;var source=new IntPtr(long.Parse(args[0]));var target=new IntPtr(long.Parse(args[1]));SetProcessDpiAwarenessContext(new IntPtr(-4));P previous;GetCursorPos(out previous);try{
  SetForegroundWindow(source);Thread.Sleep(150);if(GetForegroundWindow()!=source){Console.Error.WriteLine("Test could not foreground its source window");return 3;}keybd_event(0x1b,0,0,UIntPtr.Zero);keybd_event(0x1b,0,2,UIntPtr.Zero);Thread.Sleep(100);R bounds;GetWindowRect(source,out bounds);var a=Frame(source);var b=Frame(target);int x=bounds.l+80,y=bounds.t+24,delta=(Gap(a,b,direction)-8)*(away<0?1:-1),dx=vertical?0:delta,dy=vertical?delta:0;
  SetCursorPos(x,y);P actual;GetCursorPos(out actual);if(actual.x!=x||actual.y!=y||GetAncestor(WindowFromPoint(actual),2)!=source)throw new Exception("Titlebar target unavailable: requested="+x+","+y+" actual="+actual.x+","+actual.y+" hit="+GetAncestor(WindowFromPoint(actual),2)+" source="+source);string probe=Probe(source,x,y);mouse_event(2,0,0,0,UIntPtr.Zero);Thread.Sleep(100);
  var gui=new G();gui.size=Marshal.SizeOf(typeof(G));GetGUIThreadInfo(GetWindowThreadProcessId(source,IntPtr.Zero),ref gui);probe+=",\"buttonDown\":"+((GetAsyncKeyState(1)&0x8000)!=0?1:0)+",\"foregroundAfterDown\":"+GetForegroundWindow().ToInt64()+",\"source\":"+source.ToInt64()+",\"capture\":"+gui.capture.ToInt64()+",\"move\":"+gui.move.ToInt64()+",\"flags\":"+gui.flags;
  // Cross the native drag threshold while still inside the title bar, as a continuous physical gesture does.
  SetCursorPos(x+Math.Sign(dx)*5,y+Math.Sign(dy)*5);Thread.Sleep(35);
  string points="";for(int i=1;i<=12;i++){SetCursorPos(x+dx*i/12,y+dy*i/12);Thread.Sleep(35);P at;GetCursorPos(out at);points+=(i>1?",":"")+"["+at.x+","+at.y+"]";}probe+=",\"screen\":["+GetSystemMetrics(0)+","+GetSystemMetrics(1)+"],\"points\":["+points+"]";Thread.Sleep(150);a=Frame(source);int snapped=Gap(a,b,direction);
  SetCursorPos(x+dx+(vertical?0:away),y+dy+(vertical?away:0));Thread.Sleep(150);a=Frame(source);int detached=Gap(a,b,direction);
  keybd_event(0x12,0,0,UIntPtr.Zero);Thread.Sleep(100);SetCursorPos(x+dx,y+dy);Thread.Sleep(150);a=Frame(source);int alt=Gap(a,b,direction);
  Console.WriteLine("{"+probe+",\"snapGapPixels\":"+snapped+",\"detachGapPixels\":"+detached+",\"altGapPixels\":"+alt+"}");
 }finally{keybd_event(0x12,0,2,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);Released(source);SetCursorPos(previous.x,previous.y);}return 0;}
}
