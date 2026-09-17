// Real native resize gesture restricted to the explicitly supplied test windows.
using System;using System.Threading;using System.Runtime.InteropServices;
class ResizeProbe {
 [StructLayout(LayoutKind.Sequential)]struct R{public int l,t,r,b;}[StructLayout(LayoutKind.Sequential)]struct P{public int x,y;}
 [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr p);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr h,int a,out R r,int n);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")]static extern bool GetCursorPos(out P p);
 [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(P p);
 [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr h,uint f);
 [DllImport("user32.dll")]static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 [DllImport("user32.dll")]static extern void keybd_event(byte k,byte s,uint f,UIntPtr e);
 static R Frame(IntPtr h){R r;if(DwmGetWindowAttribute(h,9,out r,Marshal.SizeOf(typeof(R)))!=0)throw new Exception("DWM frame unavailable");return r;}
 static int Gap(R a,R b,string e){return e=="left"?a.l-b.r:e=="right"?b.l-a.r:e=="top"?a.t-b.b:b.t-a.b;}
 static int Main(string[] a){SetProcessDpiAwarenessContext(new IntPtr(-4));var source=new IntPtr(long.Parse(a[0]));var target=new IntPtr(long.Parse(a[1]));string edge=a[2];P previous;GetCursorPos(out previous);try{SetForegroundWindow(source);Thread.Sleep(150);if(GetForegroundWindow()!=source)throw new Exception("Test source not foreground");R outer;GetWindowRect(source,out outer);R start=Frame(source),other=Frame(target);int x=edge=="left"?outer.l+1:edge=="right"?outer.r-2:(outer.l+outer.r)/2,y=edge=="top"?outer.t+1:edge=="bottom"?outer.b-2:(outer.t+outer.b)/2;SetCursorPos(x,y);P at=new P{x=x,y=y};if(GetAncestor(WindowFromPoint(at),2)!=source)throw new Exception("Resize edge obscured");int sign=edge=="left"||edge=="top"?-1:1,delta=(Gap(start,other,edge)-8)*sign,dx=edge=="left"||edge=="right"?delta:0,dy=edge=="top"||edge=="bottom"?delta:0;mouse_event(2,0,0,0,UIntPtr.Zero);Thread.Sleep(100);for(int i=1;i<=12;i++){SetCursorPos(x+dx*i/12,y+dy*i/12);Thread.Sleep(35);}Thread.Sleep(180);var snapped=Frame(source);int gap=Gap(snapped,other,edge);int away=-sign*50;SetCursorPos(x+dx+(dx!=0?away:0),y+dy+(dy!=0?away:0));Thread.Sleep(150);int detach=Gap(Frame(source),other,edge);keybd_event(0x12,0,0,UIntPtr.Zero);Thread.Sleep(120);SetCursorPos(x+dx,y+dy);Thread.Sleep(160);var free=Frame(source);int alt=Gap(free,other,edge);Console.WriteLine("{\"gap\":"+gap+",\"detach\":"+detach+",\"alt\":"+alt+",\"initial\":["+start.l+","+start.t+","+start.r+","+start.b+"],\"snapped\":["+snapped.l+","+snapped.t+","+snapped.r+","+snapped.b+"]}");}finally{keybd_event(0x12,0,2,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);Thread.Sleep(150);SetCursorPos(previous.x,previous.y);}return 0;}
}
