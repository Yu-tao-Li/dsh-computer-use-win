# Owner: creates the hidden desktop and the job that ends its programs, and
# holds both until its standard input closes. Worker: starts one program on
# that desktop inside the job and relays its standard streams: the MCP server
# (-EntryPath, a whole server on the hidden desktop) or the UI Automation
# backend (-BackendScript, which the server on the user's desktop uses for the
# windows there).
[CmdletBinding(DefaultParameterSetName='Worker')]
param(
  [Parameter(Mandatory)][ValidatePattern('^Wincu-[0-9a-f]{32}$')][string]$DesktopName,
  [Parameter(Mandatory,ParameterSetName='Owner')][switch]$Own,
  [Parameter(Mandatory,ParameterSetName='Worker')][Parameter(Mandatory,ParameterSetName='Backend')][string]$Executable,
  [Parameter(Mandatory,ParameterSetName='Worker')][string]$EntryPath,
  [Parameter(Mandatory,ParameterSetName='Backend')][ValidatePattern('\\windows-uia\.ps1$')][string]$BackendScript
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

try {
  Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class WincuBackgroundDesktop {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    struct StartupInfo {
        public int Size;
        public string Reserved, Desktop, Title;
        public uint X,Y,Width,Height,Columns,Rows,Fill,Flags;
        public ushort Show, ReservedSize;
        public IntPtr ReservedData, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct ProcessInfo {
        public IntPtr Process, Thread;
        public uint ProcessId, ThreadId;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct BasicLimits {
        public long ProcessTime, JobTime;
        public uint Flags;
        public UIntPtr MinWorkingSet, MaxWorkingSet;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint Priority, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct JobLimits {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateDesktop(string name, string device, IntPtr devMode, uint flags, uint access, IntPtr security);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern bool CreateProcess(string app, StringBuilder args, IntPtr processAttrs, IntPtr threadAttrs,
        bool inherit, uint flags, IntPtr env, string directory, ref StartupInfo info, out ProcessInfo process);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool DuplicateHandle(IntPtr sourceProcess, IntPtr handle, IntPtr targetProcess,
        out IntPtr copy, uint desiredAccess, bool inherit, uint options);
    [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
    [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int stream);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern IntPtr OpenJobObject(uint access, bool inherit, string name);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetInformationJobObject(IntPtr job, int kind, ref JobLimits info, uint size);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
    [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process, uint exitCode);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static Win32Exception Error(string operation) {
        int code = Marshal.GetLastWin32Error();
        return new Win32Exception(code, operation + ": " + new Win32Exception(code).Message);
    }
    static IntPtr InheritStream(int stream) {
        IntPtr current = GetCurrentProcess();
        IntPtr copy;
        if (!DuplicateHandle(current, GetStdHandle(stream), current, out copy, 0, true, 2))
            throw Error("Could not connect the worker's standard stream");
        return copy;
    }
    static void Close(IntPtr handle) {
        if (handle != IntPtr.Zero) CloseHandle(handle);
    }
    public static void Own(string name) {
        IntPtr desktop = CreateDesktop(name, null, IntPtr.Zero, 0, 0x1ff, IntPtr.Zero);
        if (desktop == IntPtr.Zero) throw Error("Could not create a Win32 desktop");
        IntPtr job = IntPtr.Zero;
        try {
            job = CreateJobObject(IntPtr.Zero, name);
            if (job == IntPtr.Zero) throw Error("Could not create the background job");
            if (Marshal.GetLastWin32Error()==183) throw new InvalidOperationException("Background job already exists");
            var limits = new JobLimits { Basic=new BasicLimits { Flags=0x2000 } };
            if (!SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(JobLimits))))
                throw Error("Could not set up background process cleanup");
            Console.WriteLine(name);
            Console.Out.Flush();
            // The adapter holds this pipe across MCP reconnects. EOF also
            // releases the job if the DSH host terminates unexpectedly.
            while (Console.In.ReadLine()!=null) {}
        } finally {
            Close(job);
            CloseDesktop(desktop);
        }
    }
    public static int Run(string name, string executable, string commandLine, string directory) {
        var process = new ProcessInfo();
        var startup = new StartupInfo { Size=Marshal.SizeOf(typeof(StartupInfo)), Desktop="winsta0\\"+name, Flags=0x100 };
        IntPtr job = OpenJobObject(1, false, name);
        if (job == IntPtr.Zero) throw Error("The background desktop owner is unavailable");
        bool started = false;
        try {
            startup.Input=InheritStream(-10);
            startup.Output=InheritStream(-11);
            startup.Error=InheritStream(-12);
            var args = new StringBuilder(commandLine);
            if (!CreateProcess(executable, args, IntPtr.Zero, IntPtr.Zero, true, 0x08000004,
                    IntPtr.Zero, directory, ref startup, out process))
                throw Error("Could not start Wincu in the background desktop");
            if (!AssignProcessToJobObject(job, process.Process) || ResumeThread(process.Thread)==uint.MaxValue)
                throw Error("Could not start the background process safely");
            started = true;
            Close(job);
            job = IntPtr.Zero;
            uint code;
            if (WaitForSingleObject(process.Process, uint.MaxValue)!=0 || !GetExitCodeProcess(process.Process, out code))
                throw Error("Could not wait for the background process");
            return unchecked((int)code);
        } finally {
            if (!started && process.Process!=IntPtr.Zero) TerminateProcess(process.Process, 1);
            Close(startup.Input); Close(startup.Output); Close(startup.Error);
            Close(job); Close(process.Thread); Close(process.Process);
        }
    }
}
'@
  if ($Own) {
    [WincuBackgroundDesktop]::Own($DesktopName)
    exit 0
  }
  # A bare program name (WINDOWS_CU_POWERSHELL=powershell.exe) is looked up on PATH.
  $Executable = if ([IO.Path]::IsPathRooted($Executable)) { (Get-Item -LiteralPath $Executable).FullName }
    else { (Get-Command -Name $Executable -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source }
  $commandLine = if ($PSCmdlet.ParameterSetName -eq 'Backend') {
    '"' + $Executable + '" -NoLogo -NoProfile -Sta -ExecutionPolicy Bypass -File "' + (Get-Item -LiteralPath $BackendScript).FullName + '" -Persistent'
  } else { '"' + $Executable + '" "' + (Get-Item -LiteralPath $EntryPath).FullName + '"' }
  $env:WCU_BACKGROUND_DESKTOP = '1'
  exit ([WincuBackgroundDesktop]::Run($DesktopName,$Executable,$commandLine,[IO.Directory]::GetCurrentDirectory()))
} catch {
  [Console]::Error.WriteLine('WCU_BACKGROUND_DESKTOP_START_FAILED: ' + $_.Exception.Message)
  exit 1
}
