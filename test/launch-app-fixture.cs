// No-window fixture for launch_app. Exits on its own stop marker or after 90s.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

public static class LaunchFixture {
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool IsProcessInJob(IntPtr process, IntPtr job, out bool result);
  public static void Main(string[] args) {
    if (args.Length < 1) return;
    string output = args[0];
    bool inJob;
    if (!IsProcessInJob(Process.GetCurrentProcess().Handle, IntPtr.Zero, out inJob)) throw new System.ComponentModel.Win32Exception();
    int parent = 0;
    using (var search = new ManagementObjectSearcher("SELECT ParentProcessId FROM Win32_Process WHERE ProcessId=" + Process.GetCurrentProcess().Id))
      foreach (ManagementObject item in search.Get()) parent = Convert.ToInt32(item["ParentProcessId"]);
    var data = new Dictionary<string,object> {
      {"pid", Process.GetCurrentProcess().Id}, {"parentPid", parent}, {"parentName", Process.GetProcessById(parent).ProcessName}, {"inJob", inJob},
      {"args", args}, {"cwd", Environment.CurrentDirectory},
      {"electronRunAsNode", Environment.GetEnvironmentVariable("ELECTRON_RUN_AS_NODE")},
      {"poison", Environment.GetEnvironmentVariable("WCU_LAUNCH_TEST_POISON")}
    };
    File.WriteAllText(output, new JavaScriptSerializer().Serialize(data), new System.Text.UTF8Encoding(false));
    for (int i=0; i<450 && !File.Exists(output+".stop"); i++) {
      File.AppendAllText(output+".heartbeat", i+"\n");
      Thread.Sleep(200);
    }
  }
}
