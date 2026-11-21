using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

// A private STA owns CF_UNICODETEXT until the recipient has requested it and
// released the clipboard. Restoring on a fixed delay can paste the user's old
// clipboard into a slow application instead of the requested text.
public sealed class WcuClipboardLease : IDisposable {
  static readonly HashSet<string> UnsafeDelayedFormats = new HashSet<string>(StringComparer.OrdinalIgnoreCase) {
    DataFormats.Bitmap,
    DataFormats.Dib,
    "Format17",
    DataFormats.MetafilePict,
    DataFormats.EnhancedMetafile,
    DataFormats.WaveAudio,
    DataFormats.Riff,
    DataFormats.FileDrop,
    "FileName",
    "FileNameW",
    DataFormats.Locale,
    DataFormats.Palette,
    DataFormats.PenData,
    DataFormats.SymbolicLink,
    DataFormats.Dif,
    DataFormats.Tiff,
    DataFormats.Serializable,
    "Object Descriptor",
    "Embed Source",
    "Embedded Object",
    "Link Source",
    "Link Source Descriptor",
    "Native",
    "OwnerLink",
    "Ole Private Data",
    "DataObject"
  };
  readonly string text;
  readonly bool restore;
  readonly uint expectedProcessId;
  readonly ManualResetEvent ready=new ManualResetEvent(false),finished=new ManualResetEvent(false);
  volatile Owner owner;
  Exception failure;
  volatile bool read,closing,pasteSent,pasteBarrierDone,nativePasteStarted,nativePasteCompleted;
  IntPtr pasteTarget;
  public bool Restored {get;private set;}
  public bool RestorationFailed {get;private set;}
  public bool NativePasteCompleted {get{return nativePasteCompleted;}}
  public long RequestWindow {get;private set;}
  public uint RequestProcessId {get;private set;}
  public bool IsCompleted {get{return finished.WaitOne(0);}}
  public WcuClipboardLease(string value,bool restoreClipboard,int targetProcessId){
    text=value;restore=restoreClipboard;expectedProcessId=(uint)targetProcessId;
    var thread=new Thread(Run){IsBackground=true,Name="WCU delayed clipboard"};
    thread.SetApartmentState(ApartmentState.STA);thread.Start();
    if(!ready.WaitOne(3000)){closing=true;throw new TimeoutException("Clipboard owner did not start");}
    if(failure!=null)throw new InvalidOperationException("Clipboard unavailable",failure);
  }
  public void MarkPasteSent(IntPtr targetWindowHandle){
    pasteTarget=targetWindowHandle;
    pasteSent=true;
    var form=owner;if(form!=null&&read)form.Poke();
  }
  public bool TryPasteNative(IntPtr targetWindowHandle){
    var name=new System.Text.StringBuilder(128);
    GetClassName(targetWindowHandle,name,name.Capacity);
    if(!System.Text.RegularExpressions.Regex.IsMatch(name.ToString(),@"^(Edit|RichEdit\w*|WindowsForms10\.EDIT\..*|WindowsForms10\.RichEdit\w*\..*)$",System.Text.RegularExpressions.RegexOptions.IgnoreCase))return false;
    uint pid;GetWindowThreadProcessId(targetWindowHandle,out pid);
    if(pid==0||pid!=expectedProcessId)return false;
    // Native edit controls finish WM_PASTE synchronously. This also confirms
    // completion when a clipboard monitor materialized the text first.
    pasteTarget=targetWindowHandle;
    // A timed-out synchronous message can still reach the edit. Keep this
    // lease's text available just as for a dispatched keyboard paste.
    nativePasteStarted=true;
    IntPtr result;
    if(SendMessageTimeout(targetWindowHandle,0x0302,IntPtr.Zero,IntPtr.Zero,0x0002,1500,out result)==IntPtr.Zero)
      throw new TimeoutException("COMPUTER_USE_PASTE_UNCONFIRMED: the native paste did not finish within 1.5 s and was not sent again; check the field before retrying.");
    nativePasteCompleted=true;pasteSent=true;
    var form=owner;if(form!=null)form.Poke();
    return true;
  }
  public bool Complete(int timeoutMs){
    if(!finished.WaitOne(timeoutMs))return false;
    if(failure!=null)throw new InvalidOperationException("Clipboard paste failed",failure);
    return read;
  }
  public void Dispose(){closing=true;var form=owner;if(form!=null)form.Poke();}
  void Run(){
    try{using(var form=new Owner(this))Application.Run(form);}
    catch(Exception error){failure=error;ready.Set();finished.Set();}
  }
  sealed class Owner:Form {
    readonly WcuClipboardLease lease;
    readonly System.Windows.Forms.Timer timer=new System.Windows.Forms.Timer();
    System.Windows.Forms.IDataObject previous;
    DateTime expires, closeDeadline;
    bool rendered;
    uint sequence;
    internal Owner(WcuClipboardLease value){
      lease=value;ShowInTaskbar=false;FormBorderStyle=FormBorderStyle.None;Opacity=0;
      var handle=Handle;
      IntPtr originalOwner=GetClipboardOwner();
      {
        // Preserve safe text/string formats before EmptyClipboard without forcing
        // heavy or hanging delayed OLE/GDI/stream renders from third-party owners.
        var original=Clipboard.GetDataObject();
        if(original!=null){
          var copy=new DataObject();
          foreach(string format in original.GetFormats(false)){
            if(UnsafeDelayedFormats.Contains(format))continue;
            try{
              if(!original.GetDataPresent(format,false))continue;
              object item=original.GetData(format,false);
              if(item is string)copy.SetData(format,false,item);
            }catch{}
          }
          if(copy.GetFormats(false).Length!=0)previous=copy;
        }
      }
      if(GetClipboardOwner()!=originalOwner)throw new InvalidOperationException("Clipboard changed while being preserved; no input sent");
      // Materializing another owner's delayed formats can itself increment
      // the sequence number. The preserved snapshot is complete now.
      uint originalSequence=GetClipboardSequenceNumber();
      bool opened=false;
      for(int attempt=0;attempt<50&&!lease.closing;attempt++){if(OpenClipboard(handle)){opened=true;break;}Thread.Sleep(10);}
      if(!opened)throw new InvalidOperationException("Clipboard is busy; no input sent");
      try{
        if(lease.closing)throw new OperationCanceledException("Clipboard preparation cancelled");
        if(GetClipboardSequenceNumber()!=originalSequence)throw new InvalidOperationException("Clipboard changed while being preserved; no input sent");
        if(!EmptyClipboard())throw new InvalidOperationException("Could not acquire clipboard ownership; no input sent");
        SetClipboardData(13,IntPtr.Zero);
        SetPrivacyFormat("ExcludeClipboardContentFromMonitorProcessing",1);
        SetPrivacyFormat("CanIncludeInClipboardHistory",0);
        SetPrivacyFormat("CanUploadToCloudClipboard",0);
      }finally{CloseClipboard();}
      sequence=GetClipboardSequenceNumber();
      expires=DateTime.UtcNow.AddSeconds(2);timer.Interval=10;timer.Tick+=Tick;timer.Start();
      lease.owner=this;lease.ready.Set();
    }
    static void SetPrivacyFormat(string name,int dwordValue){
      uint format=RegisterClipboardFormat(name);
      if(format==0)return;
      IntPtr data=GlobalAlloc(0x42,new UIntPtr(4));
      if(data==IntPtr.Zero)return;
      IntPtr ptr=GlobalLock(data);
      if(ptr==IntPtr.Zero){GlobalFree(data);return;}
      try{Marshal.WriteInt32(ptr,dwordValue);}
      finally{GlobalUnlock(data);}
      if(SetClipboardData(format,data)==IntPtr.Zero)GlobalFree(data);
    }
    protected override bool ShowWithoutActivation{get{return true;}}
    protected override void SetVisibleCore(bool value){base.SetVisibleCore(false);}
    protected override void OnFormClosed(FormClosedEventArgs e){
      if(lease.owner==this)lease.owner=null;lease.finished.Set();
      base.OnFormClosed(e);
    }
    void Render(){
      if(rendered)return;
      IntPtr shared=GlobalAlloc(0x42,new UIntPtr((uint)((lease.text.Length+1)*2)));
      if(shared==IntPtr.Zero)throw new OutOfMemoryException();
      IntPtr destination=GlobalLock(shared);
      if(destination==IntPtr.Zero){GlobalFree(shared);throw new OutOfMemoryException();}
      try{byte[] bytes=System.Text.Encoding.Unicode.GetBytes(lease.text+"\0");Marshal.Copy(bytes,0,destination,bytes.Length);}
      finally{GlobalUnlock(shared);}
      if(SetClipboardData(13,shared)==IntPtr.Zero){GlobalFree(shared);throw new InvalidOperationException("Could not render clipboard text");}
      rendered=true;sequence=GetClipboardSequenceNumber();
    }
    protected override void WndProc(ref Message message){
      if(message.Msg==0x305&&message.WParam.ToInt32()==13){
        if(CancelledBeforeDispatch){message.Result=IntPtr.Zero;return;}
        // WM_RENDERFORMAT is sent with the reader's clipboard still open.
        // Do not call OpenClipboard here.
        IntPtr requester=GetOpenClipboardWindow();uint reader;GetWindowThreadProcessId(requester,out reader);
        lease.RequestWindow=requester.ToInt64();lease.RequestProcessId=reader;
        try{Render();}catch(Exception error){lease.failure=error;lease.finished.Set();BeginInvoke((Action)(()=>Close()));message.Result=IntPtr.Zero;return;}
        // Clipboard monitors can render before the target receives Ctrl+V.
        // If the requester cannot be identified as the target, keep this
        // text instead of restoring unrelated old data on that signal.
        lease.read=reader!=0&&reader==lease.expectedProcessId;
        if(lease.read&&lease.pasteSent)Poke();
        message.Result=IntPtr.Zero;return;
      }
      base.WndProc(ref message);
    }
    internal void Poke(){if(IsHandleCreated&&!IsDisposed)try{BeginInvoke((Action)(()=>Tick(this,EventArgs.Empty)));}catch(InvalidOperationException){}}
    bool CancelledBeforeDispatch {
      get{return (lease.closing||DateTime.UtcNow>=expires)&&!lease.pasteSent&&!lease.nativePasteStarted;}
    }
    void Tick(object sender,EventArgs e){
      try{
        bool own=GetClipboardOwner()==Handle;
        if(!own){lease.finished.Set();Close();return;}
        var now=DateTime.UtcNow;
        bool timeout=lease.closing||now>=expires;
        if(!timeout&&!lease.nativePasteCompleted&&!(lease.read&&lease.pasteSent))return;
        if(timeout&&closeDeadline==default(DateTime))closeDeadline=now.AddMilliseconds(500);
        if(lease.read&&lease.pasteSent&&!lease.nativePasteCompleted&&!lease.pasteBarrierDone&&!timeout){
          lease.pasteBarrierDone=true;
          if(lease.pasteTarget!=IntPtr.Zero){
            IntPtr dummy;
            SendMessageTimeout(lease.pasteTarget,0x0000,IntPtr.Zero,IntPtr.Zero,0x0002,250,out dummy);
            SendMessageTimeout(lease.pasteTarget,0x0000,IntPtr.Zero,IntPtr.Zero,0x0002,250,out dummy);
          }
        }
        // Taking the lock proves a slow reader has closed its clipboard.
        if(!OpenClipboard(Handle)){
          if(timeout&&now>=closeDeadline){lease.RestorationFailed=true;Close();}
          return;
        }
        bool canRestore=false, cleared=false;
        try{
          if(GetClipboardOwner()==Handle){
            if(CancelledBeforeDispatch){
              canRestore=GetClipboardSequenceNumber()==sequence;
              if(canRestore&&previous==null){cleared=EmptyClipboard();canRestore=false;}
            }else{
              if(!rendered)Render();
              canRestore=(lease.read||lease.nativePasteCompleted)&&lease.restore&&GetClipboardSequenceNumber()==sequence;
            }
          }
        }finally{CloseClipboard();}
        if(canRestore&&GetClipboardOwner()==Handle&&GetClipboardSequenceNumber()==sequence){if(previous!=null)Clipboard.SetDataObject(previous,true);else Clipboard.Clear();lease.Restored=true;}
        if(cleared)lease.Restored=true;
        lease.finished.Set();Close();
      }catch(Exception error){if(lease.read||lease.nativePasteCompleted)lease.RestorationFailed=true;else lease.failure=error;lease.finished.Set();Close();}
    }
    protected override void Dispose(bool disposing){if(disposing){timer.Stop();timer.Dispose();}base.Dispose(disposing);}
  }
  [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
  [DllImport("user32.dll")] static extern bool CloseClipboard();
  [DllImport("user32.dll")] static extern bool EmptyClipboard();
  [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format,IntPtr data);
  [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
  [DllImport("user32.dll")] static extern IntPtr GetOpenClipboardWindow();
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint processId);
  [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr window,System.Text.StringBuilder name,int count);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern uint RegisterClipboardFormat(string name);
  [DllImport("user32.dll",SetLastError=true)] static extern IntPtr SendMessageTimeout(IntPtr hWnd,uint Msg,IntPtr wParam,IntPtr lParam,uint fuFlags,uint uTimeout,out IntPtr lpdwResult);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags,UIntPtr size);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr memory);
  [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr memory);
  [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr memory);
}
