// Only the bundled mpv process audio sessions; no volume, routing or persisted user data changes.
using System;
using System.Runtime.InteropServices;
using System.IO;
using System.Diagnostics;
static class AudioBrand {
 [ComImport,Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class EnumeratorClass {}
 [ComImport,Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Enumerator {void EnumAudioEndpoints(int flow,uint mask,out Devices devices);}
 [ComImport,Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Devices {void GetCount(out uint count);void Item(uint index,out Device device);}
 [ComImport,Guid("D666063F-1587-4E43-81F1-B948E807363F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Device {void Activate(ref Guid iid,uint context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)]out object value);}
 [ComImport,Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Manager {void GetAudioSessionControl();void GetSimpleAudioVolume();void GetSessionEnumerator(out Sessions sessions);}
 [ComImport,Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Sessions {void GetCount(out int count);void GetSession(int index,out Control control);}
 [ComImport,Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] interface Control {
  void GetState(out int state);void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)]out string name);void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)]string name,ref Guid context);void GetIconPath([MarshalAs(UnmanagedType.LPWStr)]out string icon);void SetIconPath([MarshalAs(UnmanagedType.LPWStr)]string icon,ref Guid context);void GetGroupingParam(out Guid grouping);void SetGroupingParam(ref Guid grouping,ref Guid context);void RegisterAudioSessionNotification(IntPtr notification);void UnregisterAudioSessionNotification(IntPtr notification);void GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string value);void GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)]out string value);void GetProcessId(out uint pid);
 }
 static void Release(object value){if(value!=null&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
 internal static string Read(uint pid,bool apply){
  var lines=new System.Collections.Generic.List<string>();object enumerator=new EnumeratorClass();Devices devices=null;
  try{((Enumerator)enumerator).EnumAudioEndpoints(0,1,out devices);uint count;devices.GetCount(out count);
   for(uint i=0;i<count;i++){Device device=null;object manager=null;Sessions sessions=null;
    try{devices.Item(i,out device);Guid iid=new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");device.Activate(ref iid,23,IntPtr.Zero,out manager);((Manager)manager).GetSessionEnumerator(out sessions);int n;sessions.GetCount(out n);
     for(int j=0;j<n;j++){Control control=null;try{sessions.GetSession(j,out control);uint actual;control.GetProcessId(out actual);if(actual!=pid)continue;if(apply){Guid context=Guid.Empty;control.SetDisplayName("YueDen",ref context);control.SetIconPath(Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"../../assets/icon.ico")),ref context);}string name,icon;control.GetDisplayName(out name);control.GetIconPath(out icon);lines.Add(name+"|"+icon);}finally{Release(control);}}
    }finally{Release(sessions);Release(manager);Release(device);}
   }
  }finally{Release(devices);Release(enumerator);}return String.Join("\n",lines.ToArray());
 }
 internal static void Apply(uint pid){using(var process=Process.GetProcessById((int)pid)){var expected=Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"../vendor/mpv.exe"));if(!String.Equals(process.MainModule.FileName,expected,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("Audio process outside bundled player");}Read(pid,true);}
#if AUDIO_PROBE
 static int Main(string[] args){try{Console.WriteLine(Read(uint.Parse(args[0]),false));return 0;}catch(Exception e){Console.Error.WriteLine(e);return 1;}}
#endif
}
