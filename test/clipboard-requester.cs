// Compiled together with the shipped clipboard helper. No user clipboard.
public static class ClipboardRequesterProbe {
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr GetProcessWindowStation();
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetProcessWindowStation(System.IntPtr station);
 [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] static extern System.IntPtr CreateWindowStation(string name,uint flags,uint access,System.IntPtr security);
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool CloseWindowStation(System.IntPtr station);
 [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] static extern System.IntPtr CreateDesktop(string name,System.IntPtr device,System.IntPtr mode,uint flags,uint access,System.IntPtr security);
 [System.Runtime.InteropServices.DllImport("user32.dll",SetLastError=true)] static extern bool SetThreadDesktop(System.IntPtr desktop);
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool CloseDesktop(System.IntPtr desktop);
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool OpenClipboard(System.IntPtr window);
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool CloseClipboard();
 [System.Runtime.InteropServices.DllImport("user32.dll")] static extern System.IntPtr GetClipboardData(uint format);
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern System.IntPtr GlobalLock(System.IntPtr data);
 [System.Runtime.InteropServices.DllImport("kernel32.dll")] static extern bool GlobalUnlock(System.IntPtr data);
 static string Read(System.IntPtr window){
  if(!OpenClipboard(window))throw new System.Exception("Fixture could not open clipboard");
  try{var data=GetClipboardData(13);var p=GlobalLock(data);try{var value=System.Runtime.InteropServices.Marshal.PtrToStringUni(p);System.Threading.Thread.Sleep(150);return value;}finally{GlobalUnlock(data);}}
  finally{CloseClipboard();}
 }
 public static void Run(){
  var original=GetProcessWindowStation();var station=CreateWindowStation("WCU-test-"+System.Guid.NewGuid().ToString("N"),0,0x37f,System.IntPtr.Zero);
  if(station==System.IntPtr.Zero||!SetProcessWindowStation(station))throw new System.Exception("Private test station unavailable");
  System.IntPtr desktop=System.IntPtr.Zero;System.Exception failure=null;
  try{
   desktop=CreateDesktop("Default",System.IntPtr.Zero,System.IntPtr.Zero,0,0x1ff,System.IntPtr.Zero);
   if(desktop==System.IntPtr.Zero)throw new System.Exception("Private test desktop unavailable");
   var worker=new System.Threading.Thread(()=>{
    try{
     if(!SetThreadDesktop(desktop))throw new System.ComponentModel.Win32Exception(System.Runtime.InteropServices.Marshal.GetLastWin32Error());
     using(var consumer=new System.Windows.Forms.Form()){
      var window=consumer.Handle;int pid=System.Diagnostics.Process.GetCurrentProcess().Id;
      System.Windows.Forms.Clipboard.SetText("old fixture");
      using(var lease=new WcuClipboardLease("new fixture",true,pid)){
       System.Threading.Thread.Sleep(150);
       if(Read(window)!="new fixture")throw new System.Exception("Slow reader received old content");
       if(!lease.Complete(2000)||!lease.Restored)throw new System.Exception("Confirmed target did not restore clipboard");
       if(lease.RequestWindow!=window.ToInt64()||lease.RequestProcessId!=(uint)pid)throw new System.Exception("WM_RENDERFORMAT requester identity mismatch");
       if(System.Windows.Forms.Clipboard.GetText()!="old fixture")throw new System.Exception("Previous content not restored");
      }
      System.Threading.Thread.Sleep(100);
     }
    }catch(System.Exception e){failure=e;}
   });
   worker.IsBackground=true;worker.SetApartmentState(System.Threading.ApartmentState.STA);worker.Start();
   if(!worker.Join(8000))throw new System.TimeoutException("Clipboard requester fixture hung");
   if(failure!=null)throw new System.Exception("Requester fixture failed",failure);
  }finally{SetProcessWindowStation(original);if(desktop!=System.IntPtr.Zero)CloseDesktop(desktop);CloseWindowStation(station);}
 }
}
