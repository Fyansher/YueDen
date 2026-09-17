using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
[assembly: AssemblyTitle("悦森盒 YueDen")]
[assembly: AssemblyProduct("悦森盒 YueDen")]
[assembly: AssemblyDescription("本地数字内容管理、播放与阅读")]
[assembly: AssemblyVersion("1.0.1.0")]
[assembly: AssemblyFileVersion("1.0.1.0")]
internal static class Launcher {
    [STAThread] private static void Main() {
        try {
            string folder = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "程序");
            string program = Path.Combine(folder, "YueDen.exe");
            if (!File.Exists(program)) throw new FileNotFoundException("程序文件不完整。请完整解压 ZIP，不要只复制启动图标。");
            int port; string diagnostic = "";
            if (Int32.TryParse(Environment.GetEnvironmentVariable("UM_DEBUG_PORT"), out port) && port >= 1024 && port <= 65535)
                diagnostic = "--remote-debugging-address=127.0.0.1 --remote-debugging-port=" + port;
            Process.Start(new ProcessStartInfo { FileName = program, WorkingDirectory = folder, UseShellExecute = false, Arguments = diagnostic });
        } catch (Exception error) { MessageBox.Show(error.Message, "悦森盒 YueDen · 无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error); }
    }
}
