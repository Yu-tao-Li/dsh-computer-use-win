// Compiled together with the shipped clipboard helper. No user clipboard.
public static class ClipboardRequesterProbe {
 sealed class SlowEdit:System.Windows.Forms.TextBox {
  protected override void WndProc(ref System.Windows.Forms.Message message){
   if(message.Msg==0x0302)System.Threading.Thread.Sleep(150);
   base.WndProc(ref message);
  }
 }
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
       lease.MarkPasteSent(System.IntPtr.Zero);
       System.Threading.Thread.Sleep(150);
       if(Read(window)!="new fixture")throw new System.Exception("Slow reader received old content");
       if(!lease.Complete(2000)||!lease.Restored)throw new System.Exception("Confirmed target did not restore clipboard");
       if(lease.RequestWindow!=window.ToInt64()||lease.RequestProcessId!=(uint)pid)throw new System.Exception("WM_RENDERFORMAT requester identity mismatch");
       if(System.Windows.Forms.Clipboard.GetText()!="old fixture")throw new System.Exception("Previous content not restored");
      }
      foreach(bool restore in new[]{true,false}){
       System.Windows.Forms.Clipboard.SetText("original before cancellation");
       using(var lease=new WcuClipboardLease("cancelled text",restore,pid)){
        lease.Dispose();
        lease.Complete(1500);
        var actual=System.Windows.Forms.Clipboard.GetText();
        if(!lease.IsCompleted||!lease.Restored||actual!="original before cancellation")
         throw new System.Exception("Cancellation before dispatch did not preserve the clipboard (restore="+restore+", completed="+lease.IsCompleted+", restored="+lease.Restored+", actual="+actual+")");
       }
      }
      System.Windows.Forms.Clipboard.SetText("original before monitor");
      using(var lease=new WcuClipboardLease("monitored text",true,pid)){
       if(Read(System.IntPtr.Zero)!="monitored text")throw new System.Exception("Monitor did not read delayed text");
       lease.Dispose();
       lease.Complete(1500);
       if(!lease.Restored||System.Windows.Forms.Clipboard.GetText()!="original before monitor")
        throw new System.Exception("Monitor access was mistaken for dispatched paste");
      }
      System.Windows.Forms.Clipboard.Clear();
      using(var lease=new WcuClipboardLease("cancelled on empty clipboard",true,pid)){
       lease.Dispose();
       lease.Complete(1500);
       if(!lease.IsCompleted||System.Windows.Forms.Clipboard.ContainsText())
        throw new System.Exception("Cancellation populated an empty clipboard");
      }
      // A remote clipboard monitor can consume delayed text before Ctrl+V.
      // No second WM_RENDERFORMAT occurs when the edit subsequently pastes.
      foreach(var edit in new System.Windows.Forms.TextBoxBase[]{new SlowEdit{Multiline=true},new System.Windows.Forms.RichTextBox()}){
       using(edit){
        var editWindow=edit.Handle;
        System.Windows.Forms.Clipboard.SetText("old monitor fixture");
        using(var lease=new WcuClipboardLease("new\r\nmonitor fixture",true,pid)){
         if(Read(System.IntPtr.Zero)!="new\r\nmonitor fixture")throw new System.Exception("Monitor did not materialize text");
         if(lease.Complete(0))throw new System.Exception("An unknown monitor was mistaken for the recipient");
         if(!lease.TryPasteNative(editWindow))throw new System.Exception("Native edit paste was not dispatched");
         lease.Complete(1000);
         if(edit.Text.Replace("\r\n","\n")!="new\nmonitor fixture")throw new System.Exception("Native edit received wrong text: "+edit.GetType().Name+"="+edit.Text);
         if(!lease.IsCompleted||!lease.NativePasteCompleted||!lease.Restored)throw new System.Exception("Monitor-first paste did not restore the clipboard");
         if(lease.RequestProcessId!=0)throw new System.Exception("The monitor must not be reported as a confirmed target read");
         if(System.Windows.Forms.Clipboard.GetText()!="old monitor fixture")throw new System.Exception("Monitor-first previous content not restored");
        }
       }
      }
      System.Windows.Forms.Clipboard.SetText("old no-restore fixture");
      using(var edit=new System.Windows.Forms.TextBox())
      using(var lease=new WcuClipboardLease("new no-restore fixture",false,pid)){
       if(!lease.TryPasteNative(edit.Handle))throw new System.Exception("Native edit was not recognized");
       lease.Complete(1000);
       if(edit.Text!="new no-restore fixture"||lease.Restored||System.Windows.Forms.Clipboard.GetText()!="new no-restore fixture")throw new System.Exception("restoreClipboard:false was not respected");
      }
      System.Windows.Forms.Clipboard.SetText("old unsupported fixture");
      using(var lease=new WcuClipboardLease("new unsupported fixture",true,pid)){
       Read(System.IntPtr.Zero);
       if(lease.TryPasteNative(window))throw new System.Exception("A custom window must retain the keyboard paste path");
       lease.MarkPasteSent(window);
       lease.Dispose();lease.Complete(1000);
       if(lease.Restored||System.Windows.Forms.Clipboard.GetText()!="new unsupported fixture")throw new System.Exception("Unconfirmed paste must remain available for a slow consumer");
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
