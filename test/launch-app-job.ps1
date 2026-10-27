param([Parameter(Mandatory=$true)][string]$Config)
$ErrorActionPreference = 'Stop'
# This creates an isolated job for the test's own node + MCP descendants only.
# A suspended launch guarantees assignment before any child can be created.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class LaunchTestJob {
  [StructLayout(LayoutKind.Sequential)] public struct STARTUPINFO {
    public int cb; public string reserved,desktop,title; public int x,y,cx,cy,xChars,yChars,fill,flags; public short show,reserved2; public IntPtr reservedPtr,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] public struct PROCESSINFO { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] public struct BASIC {
    public long processTime,jobTime; public uint flags; public UIntPtr min,max; public uint active;
    public UIntPtr affinity; public uint priority,scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] public struct IO { public ulong rOps,wOps,oOps,rBytes,wBytes,oBytes; }
  [StructLayout(LayoutKind.Sequential)] public struct EXTENDED { public BASIC basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr security,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref EXTENDED info,uint size);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder line,IntPtr processSecurity,IntPtr threadSecurity,bool inherit,uint flags,IntPtr env,string cwd,ref STARTUPINFO startup,out PROCESSINFO process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint code);
  public static IntPtr Start(string exe,string arguments,string cwd) {
    var job=CreateJobObject(IntPtr.Zero,null);
    if(job==IntPtr.Zero) throw new System.ComponentModel.Win32Exception();
    var limits=new EXTENDED(); limits.basic.flags=0x2000;
    if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits))) { CloseHandle(job); throw new System.ComponentModel.Win32Exception(); }
    var startup=new STARTUPINFO(); startup.cb=Marshal.SizeOf(startup); var process=new PROCESSINFO();
    if(!CreateProcess(exe,new StringBuilder("\""+exe+"\" "+arguments),IntPtr.Zero,IntPtr.Zero,false,0x08000004,IntPtr.Zero,cwd,ref startup,out process)) {
      CloseHandle(job); throw new System.ComponentModel.Win32Exception();
    }
    try {
      if(!AssignProcessToJobObject(job,process.process)) throw new System.ComponentModel.Win32Exception();
      if(ResumeThread(process.thread)==0xffffffff) throw new System.ComponentModel.Win32Exception();
      return job;
    } catch { TerminateProcess(process.process,1); CloseHandle(job); throw; }
    finally { CloseHandle(process.thread); CloseHandle(process.process); }
  }
}
'@
$data = Get-Content -LiteralPath $Config -Raw -Encoding UTF8 | ConvertFrom-Json
$job = [LaunchTestJob]::Start($data.node, $data.arguments, $data.cwd)
try {
  $deadline = [DateTime]::UtcNow.AddSeconds(65)
  while (-not (Test-Path -LiteralPath $data.ready) -and [DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 100 }
  if (-not (Test-Path -LiteralPath $data.ready)) { throw 'Job child did not report dispatch completion within 65 seconds.' }
} finally { [void][LaunchTestJob]::CloseHandle($job) }
Write-Output 'PASS closed isolated KILL_ON_JOB_CLOSE job (without breakaway flags)'
