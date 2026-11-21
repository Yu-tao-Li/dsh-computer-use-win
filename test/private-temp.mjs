import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Test-created trees sometimes inherit shared-write ACLs from TEMP. Give
// compiled helper fixtures the same permissions as the production cache.
export function makePrivateTemp(directory) {
  const powershell=path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command=String.raw`
$ErrorActionPreference='Stop'
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.DirectorySecurity]::new()
$acl.SetAccessRuleProtection($true,$false)
foreach($owner in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {
  $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($owner,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
}
[IO.Directory]::SetAccessControl($env:WCU_PRIVATE_TEMP,$acl)
`;
  execFileSync(powershell,['-NoProfile','-NonInteractive','-Command',command],{
    windowsHide:true,env:{...process.env,WCU_PRIVATE_TEMP:directory},
  });
}
