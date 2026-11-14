$ErrorActionPreference='Stop'
$tokens=$null;$errors=$null
$ast=[Management.Automation.Language.Parser]::ParseFile((Join-Path $PSScriptRoot '../scripts/windows-uia.ps1'),[ref]$tokens,[ref]$errors)
if($errors.Count){throw ($errors|Out-String)}
$function=$ast.Find({param($node)$node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Begin-ClipboardLease'},$true)
Add-Type -TypeDefinition @'
using System;
public static class WindowsComputerUseNative {
 public static bool NoFocus;
 public static IntPtr GetForegroundWindow(){return new IntPtr(100);}
 public static IntPtr FocusedWindow(IntPtr parent){if(parent.ToInt64()!=100)throw new Exception("Wrong parent");return NoFocus?IntPtr.Zero:new IntPtr(200);}
 public static uint GetWindowThreadProcessId(IntPtr window,out uint pid){pid=window.ToInt64()==200?42u:999u;return 1;}
}
public class WcuClipboardLease {
 public int Target;
 public WcuClipboardLease(string text,bool restore,int target){Target=target;}
}
'@
. ([scriptblock]::Create($function.Extent.Text))
$lease=Begin-ClipboardLease 'fixture' $true
if($lease.Target -ne 42){throw 'Clipboard confirmation must use the focused child process, not the foreground frame process'}
[WindowsComputerUseNative]::NoFocus=$true
$lease=Begin-ClipboardLease 'fixture' $true
if($lease.Target -ne 0){throw 'Unknown focus must not fall back to the frame process'}
Write-Output 'PASS clipboard requester uses focused child PID and treats unknown focus as unconfirmed (fake native APIs)'
