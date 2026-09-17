// Read-only native diagnostics. No input injection or window mutation.
using System;using System.Collections.Generic;using System.Runtime.InteropServices;using System.Text;using System.Web.Script.Serialization;
class VideoInspect {
 [StructLayout(LayoutKind.Sequential)] struct R{public int left,top,right,bottom;}
 [StructLayout(LayoutKind.Sequential)] struct P{public int x,y;}
 [DllImport("user32.dll")]static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr GetParent(IntPtr h);
 [DllImport("user32.dll")]static extern IntPtr GetAncestor(IntPtr h,uint flags);
 [DllImport("user32.dll")]static extern bool GetWindowRect(IntPtr h,out R r);
 [DllImport("user32.dll")]static extern bool GetClientRect(IntPtr h,out R r);
 [DllImport("user32.dll")]static extern IntPtr GetWindow(IntPtr h,uint command);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)]static extern int GetClassName(IntPtr h,StringBuilder s,int n);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")]static extern IntPtr GetWindowLong(IntPtr h,int index);
 [DllImport("user32.dll")]static extern IntPtr WindowFromPoint(P p);
 [DllImport("user32.dll")]static extern bool SetProcessDpiAwarenessContext(IntPtr context);
 static Dictionary<string,object> Read(IntPtr h,int depth){R r,c;uint pid;GetWindowRect(h,out r);GetClientRect(h,out c);GetWindowThreadProcessId(h,out pid);var name=new StringBuilder(256);GetClassName(h,name,256);return new Dictionary<string,object>{{"hwnd",h.ToInt64().ToString()},{"parent",GetParent(h).ToInt64().ToString()},{"pid",pid},{"depth",depth},{"class",name.ToString()},{"valid",IsWindow(h)},{"visible",IsWindowVisible(h)},{"style",GetWindowLong(h,-16).ToInt64().ToString("X")},{"rect",r},{"client",c},{"centerHit",WindowFromPoint(new P{x=(r.left+r.right)/2,y=(r.top+r.bottom)/2}).ToInt64().ToString()}};}
 static void Walk(IntPtr parent,int depth,List<object> rows){if(depth>6)return;for(var child=GetWindow(parent,5);child!=IntPtr.Zero;child=GetWindow(child,2)){rows.Add(Read(child,depth));Walk(child,depth+1,rows);}}
 static void Main(string[] args){SetProcessDpiAwarenessContext(new IntPtr(-4));var h=new IntPtr(long.Parse(args[0]));var root=GetAncestor(h,2);var rows=new List<object>();rows.Add(Read(root,0));Walk(root,1,rows);Console.WriteLine(new JavaScriptSerializer().Serialize(new{video=Read(h,0),root=root.ToInt64().ToString(),zOrder=rows}));}
}
