// Test only: independent observations and input restricted to a supplied test HWND.
using System;using System.Runtime.InteropServices;
class WindowProbe {
 [StructLayout(LayoutKind.Sequential)]struct R{public int l,t,r,b;}
 [StructLayout(LayoutKind.Sequential)]struct P{public int x,y;}
 [StructLayout(LayoutKind.Sequential)]struct C{public int size,flags;public IntPtr cursor;public P point;}
 [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr p);
 [DllImport("dwmapi.dll")]static extern int DwmGetWindowAttribute(IntPtr h,int a,out R r,int n);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32.dll")]static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll",SetLastError=true)]static extern bool GetCursorInfo(ref C c);
 [DllImport("user32.dll")]static extern uint GetDpiForWindow(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")]static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")]static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,IntPtr p);
 [DllImport("kernel32.dll")]static extern uint GetCurrentThreadId();
 [DllImport("user32.dll")]static extern bool AttachThreadInput(uint a,uint b,bool join);
 [DllImport("user32.dll")]static extern IntPtr GetTopWindow(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr h,uint direction);
 static int Main(string[] a){
  SetProcessDpiAwarenessContext(new IntPtr(-4));var h=new IntPtr(long.Parse(a[0]));
  if(a.Length==1){R r;if(DwmGetWindowAttribute(h,9,out r,Marshal.SizeOf(typeof(R)))!=0&&!GetWindowRect(h,out r))throw new Exception("Window unavailable");Console.WriteLine("{\"x\":"+r.l+",\"y\":"+r.t+",\"width\":"+(r.r-r.l)+",\"height\":"+(r.b-r.t)+",\"scale\":"+(GetDpiForWindow(h)/96.0).ToString(System.Globalization.CultureInfo.InvariantCulture)+"}");return 0;}
  if(a[1]=="focus"){var current=GetCurrentThreadId();var foreground=GetWindowThreadProcessId(GetForegroundWindow(),IntPtr.Zero);bool joined=current!=foreground&&AttachThreadInput(current,foreground,true);try{SetForegroundWindow(h);}finally{if(joined)AttachThreadInput(current,foreground,false);}}
  else if(a[1]=="stack"){var wanted=new System.Collections.Generic.HashSet<string>(a[2].Split(','));var result=new System.Collections.Generic.List<string>();for(var at=GetTopWindow(IntPtr.Zero);at!=IntPtr.Zero;at=GetWindow(at,2))if(wanted.Contains(at.ToInt64().ToString()))result.Add(at.ToInt64().ToString());Console.WriteLine("{\"order\":["+string.Join(",",result)+"]}");return 0;}
  else if(a[1]=="move"){if(!SetCursorPos(int.Parse(a[2]),int.Parse(a[3])))throw new Exception("Cursor movement failed");}
  else if(a[1]=="key"){
   if(GetForegroundWindow()!=h)throw new Exception("Refusing keys outside supplied test HWND: expected="+h+" actual="+GetForegroundWindow());
   if(a[2]!="escape"&&a[2]!="f"&&a[2]!="altTab")throw new Exception("Unsupported test key");
   byte key=a[2]=="escape"?(byte)0x1b:a[2]=="f"?(byte)0x46:(byte)0x09;bool alt=a[2]=="altTab";
   try{if(alt)keybd_event(0x12,0,0,UIntPtr.Zero);keybd_event(key,0,0,UIntPtr.Zero);keybd_event(key,0,2,UIntPtr.Zero);}finally{if(alt)keybd_event(0x12,0,2,UIntPtr.Zero);}
  }else if(a[1]!="read")throw new Exception("Unsupported test operation");
  C info=new C();info.size=Marshal.SizeOf(typeof(C));if(!GetCursorInfo(ref info))throw new Exception("GetCursorInfo failed: "+Marshal.GetLastWin32Error());
  Console.WriteLine("{\"flags\":"+info.flags+",\"cursor\":"+info.cursor.ToInt64()+",\"foreground\":"+GetForegroundWindow().ToInt64()+",\"x\":"+info.point.x+",\"y\":"+info.point.y+"}");return 0;
 }
}
