// Standard Windows Common Item Dialog; COM order follows shobjidl_core.h.
// Paths are returned as UTF-8/base64 lines. Never reads or modifies selected files.
using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]
public struct Filter { [MarshalAs(UnmanagedType.LPWStr)]public string Name;[MarshalAs(UnmanagedType.LPWStr)]public string Pattern; }
[ComImport,Guid("d57c7288-d4ad-4768-be02-9d969532d960"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IOpen {
 [PreserveSig]int Show(IntPtr owner);
 void SetFileTypes(uint count,[MarshalAs(UnmanagedType.LPArray,SizeParamIndex=0)]Filter[] filters);
 void SetFileTypeIndex(uint index);void GetFileTypeIndex(out uint index);
 void Advise(IEvents sink,out uint cookie);void Unadvise(uint cookie);void SetOptions(uint options);void GetOptions(out uint options);
 void SetDefaultFolder(IShellItem folder);void SetFolder(IShellItem folder);void GetFolder(out IShellItem folder);void GetCurrentSelection(out IShellItem item);
 void SetFileName([MarshalAs(UnmanagedType.LPWStr)]string name);void GetFileName([MarshalAs(UnmanagedType.LPWStr)]out string name);
 void SetTitle([MarshalAs(UnmanagedType.LPWStr)]string title);void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)]string text);void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)]string text);
 void GetResult(out IShellItem item);void AddPlace(IShellItem item,uint place);void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)]string text);
 void Close(int hr);void SetClientGuid(ref Guid guid);void ClearClientData();void SetFilter(IntPtr filter);
 void GetResults(out IShellItemArray items);void GetSelectedItems(out IShellItemArray items);
}
[ComImport,Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItem {
 void BindToHandler(IntPtr context,ref Guid handler,ref Guid iid,out IntPtr value);void GetParent(out IShellItem parent);
 void GetDisplayName(uint sigdn,out IntPtr name);void GetAttributes(uint mask,out uint attributes);void Compare(IShellItem item,uint hint,out int order);
}
[ComImport,Guid("b63ea76d-1f85-456f-a19c-48159efa858b"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IShellItemArray {
 void BindToHandler(IntPtr context,ref Guid handler,ref Guid iid,out IntPtr value);void GetPropertyStore(uint flags,ref Guid iid,out IntPtr value);void GetPropertyDescriptionList(IntPtr key,ref Guid iid,out IntPtr value);
 void GetAttributes(uint flags,uint mask,out uint attributes);void GetCount(out uint count);void GetItemAt(uint index,out IShellItem item);void EnumItems(out IntPtr value);
}
[ComImport,Guid("e6fdd21a-163f-4975-9c8c-a69f1ba37034"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface ICustomize {
 void EnableOpenDropDown(uint id);void AddMenu(uint id,[MarshalAs(UnmanagedType.LPWStr)]string text);void AddPushButton(uint id,[MarshalAs(UnmanagedType.LPWStr)]string text);
 void AddComboBox(uint id);void AddRadioButtonList(uint id);void AddCheckButton(uint id,[MarshalAs(UnmanagedType.LPWStr)]string text,[MarshalAs(UnmanagedType.Bool)]bool value);
 void AddEditBox(uint id,[MarshalAs(UnmanagedType.LPWStr)]string text);void AddSeparator(uint id);void AddText(uint id,[MarshalAs(UnmanagedType.LPWStr)]string text);
 void SetControlLabel(uint id,[MarshalAs(UnmanagedType.LPWStr)]string text);void GetControlState(uint id,out uint state);void SetControlState(uint id,uint state);
}
[Guid("973510db-7d7f-452b-8975-74a85828d354"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown),ComVisible(true)]
public interface IEvents {
 [PreserveSig]int OnFileOk(IOpen dialog);[PreserveSig]int OnFolderChanging(IOpen dialog,IShellItem folder);[PreserveSig]int OnFolderChange(IOpen dialog);[PreserveSig]int OnSelectionChange(IOpen dialog);
 [PreserveSig]int OnShareViolation(IOpen dialog,IShellItem item,out uint response);[PreserveSig]int OnTypeChange(IOpen dialog);[PreserveSig]int OnOverwrite(IOpen dialog,IShellItem item,out uint response);
}
[Guid("36116642-d713-4b97-9b83-7484a9d00433"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown),ComVisible(true)]
public interface IControlEvents {
 [PreserveSig]int OnItemSelected(ICustomize dialog,uint control,uint item);[PreserveSig]int OnButtonClicked(ICustomize dialog,uint control);
 [PreserveSig]int OnCheckButtonToggled(ICustomize dialog,uint control,[MarshalAs(UnmanagedType.Bool)]bool value);[PreserveSig]int OnControlActivating(ICustomize dialog,uint control);
}
[ComVisible(true),ClassInterface(ClassInterfaceType.None)]
public class Events:IEvents,IControlEvents {
 public IOpen Dialog;public ICustomize Controls;public bool Multiple;public string[] Result;
 public static string FilePath(IShellItem item){IntPtr ptr;item.GetDisplayName(0x80058000,out ptr);try{return Marshal.PtrToStringUni(ptr);}finally{Marshal.FreeCoTaskMem(ptr);}}
 public static string[] Paths(IShellItemArray items){var result=new List<string>();uint count;items.GetCount(out count);for(uint i=0;i<count&&i<200;i++){IShellItem item;items.GetItemAt(i,out item);try{string file=FilePath(item);if(File.Exists(file)||Directory.Exists(file))result.Add(file);}finally{Marshal.ReleaseComObject(item);}}return result.ToArray();}
 public int OnButtonClicked(ICustomize dialog,uint control){try{if(control!=100)return 0;IShellItemArray selection=null;string[] selected=new string[0];try{Dialog.GetSelectedItems(out selection);selected=Paths(selection).Where(Directory.Exists).ToArray();}catch{}finally{if(selection!=null)Marshal.ReleaseComObject(selection);}if(selected.Length==0){IShellItem folder;Dialog.GetFolder(out folder);try{selected=new[]{FilePath(folder)};}finally{Marshal.ReleaseComObject(folder);}}if(selected.Length>0&&selected.All(Directory.Exists)){Result=Multiple?selected:selected.Take(1).ToArray();Dialog.Close(0);}}catch{}return 0;}
 public int OnSelectionChange(IOpen dialog){try{IShellItem item;dialog.GetCurrentSelection(out item);try{Controls.SetControlLabel(100,Directory.Exists(FilePath(item))?"选择所选文件夹":"选择当前文件夹");}finally{Marshal.ReleaseComObject(item);}}catch{}return 0;}
 public int OnFileOk(IOpen dialog){return 0;}public int OnFolderChanging(IOpen dialog,IShellItem folder){return 0;}public int OnFolderChange(IOpen dialog){try{Controls.SetControlLabel(100,"选择当前文件夹");}catch{}return 0;}
 public int OnShareViolation(IOpen dialog,IShellItem item,out uint response){response=0;return 0;}public int OnTypeChange(IOpen dialog){return 0;}public int OnOverwrite(IOpen dialog,IShellItem item,out uint response){response=0;return 0;}
 public int OnItemSelected(ICustomize dialog,uint control,uint item){return 0;}public int OnCheckButtonToggled(ICustomize dialog,uint control,bool value){return 0;}public int OnControlActivating(ICustomize dialog,uint control){return 0;}
}
class ResourcePicker {
 [DllImport("shell32.dll",CharSet=CharSet.Unicode,PreserveSig=false)]static extern void SHCreateItemFromParsingName(string path,IntPtr context,ref Guid iid,out IShellItem item);
 [DllImport("user32.dll")]static extern bool SetProcessDPIAware();
 [STAThread]static int Main(string[] args){IOpen dialog=null;uint cookie=0;try{
  SetProcessDPIAware();dialog=(IOpen)Activator.CreateInstance(Type.GetTypeFromCLSID(new Guid("dc1c5a9c-e88a-4dde-a5a1-60f82a20aef7")));
  bool multiple=args.Contains("--multiple"),selfTest=args.Contains("--self-test");var controls=(ICustomize)dialog;
  dialog.SetTitle("选择本地资源文件或文件夹");dialog.SetFileTypes(1,new[]{new Filter{Name="所有文件（All Files）",Pattern="*.*"}});
  dialog.SetOptions(0x40|0x800|0x1000|0x02000000|(multiple?0x200u:0));
  controls.AddPushButton(100,"选择当前文件夹");var sink=new Events{Dialog=dialog,Controls=controls,Multiple=multiple};dialog.Advise(sink,out cookie);
  string initial=args.Length>1?Encoding.UTF8.GetString(Convert.FromBase64String(args[1])):Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
  if(File.Exists(initial))initial=Path.GetDirectoryName(initial);
  if(Directory.Exists(initial)){Guid iid=new Guid("43826d1e-e718-42ee-bc55-a1e261c37bfe");IShellItem folder;SHCreateItemFromParsingName(initial,IntPtr.Zero,ref iid,out folder);try{dialog.SetFolder(folder);}finally{Marshal.ReleaseComObject(folder);}}
  if(selfTest){IShellItem current;dialog.GetFolder(out current);try{Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(Events.FilePath(current))));}finally{Marshal.ReleaseComObject(current);}return 0;}
  long handle;IntPtr owner=args.Length>0&&long.TryParse(args[0],out handle)?new IntPtr(handle):IntPtr.Zero;
  int hr=dialog.Show(owner);if(hr==unchecked((int)0x800704c7))return 0;Marshal.ThrowExceptionForHR(hr);
  string[] selected=sink.Result;if(selected==null){IShellItemArray results;dialog.GetResults(out results);try{selected=Events.Paths(results);}finally{Marshal.ReleaseComObject(results);}}
  foreach(string selectedPath in (multiple?selected:selected.Take(1)))Console.WriteLine(Convert.ToBase64String(Encoding.UTF8.GetBytes(selectedPath)));return 0;
 }catch(Exception error){Console.Error.WriteLine(error.Message);return 1;}finally{if(dialog!=null){if(cookie!=0)dialog.Unadvise(cookie);Marshal.ReleaseComObject(dialog);}}}
}
