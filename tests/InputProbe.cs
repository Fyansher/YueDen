using System;using System.Text;using System.Runtime.InteropServices;
class InputProbe{
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr h,StringBuilder name,int max);
 [DllImport("user32.dll")]static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
 static int Main(string[] args){if(args.Length!=2)return 2;var h=new IntPtr(long.Parse(args[0]));var name=new StringBuilder(128);GetClassName(h,name,128);if(name.ToString()!="YueDenVideoSurface")return 3;
 foreach(var command in args[1].Split(',')){if(command=="focus")SendMessage(h,0x201,new IntPtr(1),new IntPtr(10|(10<<16)));else if(command=="double")SendMessage(h,0x203,new IntPtr(1),new IntPtr(10|(10<<16)));else if(command=="wheelup"||command=="wheeldown")SendMessage(h,0x20A,new IntPtr((command=="wheelup"?120:-120)<<16),IntPtr.Zero);else{var key=int.Parse(command);SendMessage(h,0x100,new IntPtr(key),new IntPtr(1L|(1L<<30)));}}return 0;
 }
}
