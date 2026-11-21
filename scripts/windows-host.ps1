# Backbeat's Windows helper, started once by src/windows.ts and kept running.
# Reads one command per line on stdin and answers each with one JSON line on stdout.
# Playback and track info go through Windows' media controls (SMTC); volume goes through
# Spotify's entry in the Windows volume mixer (Core Audio), like the per-app slider.
# Needs Windows PowerShell 5.1 (powershell.exe): PowerShell 7 cannot load WinRT types.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and
  $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1

function Await($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'Windows media controls did not answer in time.' }
  $task.Result
}

$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
$managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propsType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]
$manager = Await ($managerType::RequestAsync()) $managerType

# Desktop app: "Spotify.exe". Microsoft Store app: "SpotifyAB.SpotifyMusic_...!Spotify".
function Get-SpotifySession {
  foreach ($s in $manager.GetSessions()) { if ($s.SourceAppUserModelId -match 'spotify') { return $s } }
  $null
}
function Test-SpotifyProcess { [bool](Get-Process -Name Spotify -ErrorAction SilentlyContinue) }

# Spotify shows up in media controls only after it has played something since it started.
function Require-Session {
  $s = Get-SpotifySession
  if ($s) { return $s }
  if (Test-SpotifyProcess) { throw 'Spotify has not started playback since it opened. Press play in Spotify once.' }
  throw 'NOT_RUNNING'
}

function Change($ok, [string]$what) {
  if (-not $ok) { throw "Spotify does not let other apps change $what on Windows. Use the Spotify window." }
}

$audioSource = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;

namespace Backbeat {
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl();
    int GetSimpleAudioVolume();
    [PreserveSig] int GetSessionEnumerator(out IAudioSessionEnumerator sessions);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, out IAudioSessionControl2 session);
  }
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    // The nine IAudioSessionControl methods, then GetSessionIdentifier and GetSessionInstanceIdentifier.
    int M1(); int M2(); int M3(); int M4(); int M5(); int M6(); int M7(); int M8(); int M9(); int M10(); int M11();
    [PreserveSig] int GetProcessId(out uint pid);
  }
  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    [PreserveSig] int SetMasterVolume(float level, ref Guid eventContext);
    [PreserveSig] int GetMasterVolume(out float level);
  }
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}

  public static class SpotifyVolume {
    // shortcut: only the default output device is searched; extend if users route Spotify elsewhere.
    static List<ISimpleAudioVolume> Find() {
      var found = new List<ISimpleAudioVolume>();
      var devices = (IMMDeviceEnumerator)new MMDeviceEnumerator();
      IMMDevice device;
      if (devices.GetDefaultAudioEndpoint(0, 1, out device) != 0) return found; // no speakers
      var iid = typeof(IAudioSessionManager2).GUID;
      object manager;
      Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out manager));
      IAudioSessionEnumerator sessions;
      Marshal.ThrowExceptionForHR(((IAudioSessionManager2)manager).GetSessionEnumerator(out sessions));
      int count;
      sessions.GetCount(out count);
      for (int i = 0; i < count; i++) {
        IAudioSessionControl2 session;
        uint pid;
        if (sessions.GetSession(i, out session) != 0 || session.GetProcessId(out pid) != 0) continue;
        try {
          if (string.Equals(Process.GetProcessById((int)pid).ProcessName, "Spotify", StringComparison.OrdinalIgnoreCase))
            found.Add((ISimpleAudioVolume)session);
        } catch (ArgumentException) { } // process already gone
      }
      return found;
    }
    public static int Get() {
      var all = Find();
      if (all.Count == 0) return -1;
      float level;
      Marshal.ThrowExceptionForHR(all[0].GetMasterVolume(out level));
      return (int)Math.Round(level * 100);
    }
    public static bool Set(int percent) {
      var all = Find();
      var context = Guid.Empty;
      foreach (var v in all) Marshal.ThrowExceptionForHR(v.SetMasterVolume(percent / 100f, ref context));
      return all.Count > 0;
    }
  }
}
'@
$audioLoaded = $false
function Use-Audio {
  # Compiling takes a second or two, so it waits until volume is first used.
  if (-not $script:audioLoaded) { Add-Type -TypeDefinition $audioSource; $script:audioLoaded = $true }
  if (-not (Test-SpotifyProcess)) { throw 'NOT_RUNNING' }
}
$noStream = 'Spotify has no audio stream right now. Start playback, then try again.'

function Invoke-Backbeat([string]$cmd, [string]$arg) {
  switch ($cmd) {
    'state' {
      $s = Get-SpotifySession
      if (-not $s) { return @{ session = $false; process = (Test-SpotifyProcess) } }
      $p = Await ($s.TryGetMediaPropertiesAsync()) $propsType
      return @{ session = $true; status = [string]$s.GetPlaybackInfo().PlaybackStatus; title = $p.Title; artist = $p.Artist; album = $p.AlbumTitle }
    }
    'playPause' { $null = Await ((Require-Session).TryTogglePlayPauseAsync()) ([bool]) }
    'next' { $null = Await ((Require-Session).TrySkipNextAsync()) ([bool]) }
    'previous' { $null = Await ((Require-Session).TrySkipPreviousAsync()) ([bool]) }
    'shuffle' {
      $s = Require-Session
      Change (Await ($s.TryChangeShuffleActiveAsync(-not $s.GetPlaybackInfo().IsShuffleActive)) ([bool])) 'shuffle'
    }
    'repeat' {
      $s = Require-Session
      $mode = if ([string]$s.GetPlaybackInfo().AutoRepeatMode -in @('', 'None')) { 'List' } else { 'None' }
      Change (Await ($s.TryChangeAutoRepeatModeAsync($mode)) ([bool])) 'repeat'
    }
    'getVolume' {
      Use-Audio
      $v = [Backbeat.SpotifyVolume]::Get()
      if ($v -lt 0) { throw $noStream }
      return $v
    }
    'setVolume' {
      Use-Audio
      if (-not [Backbeat.SpotifyVolume]::Set([int]$arg)) { throw $noStream }
    }
    default { throw "Unknown command: $cmd" }
  }
}

function Reply($reply) {
  [Console]::Out.WriteLine((ConvertTo-Json $reply -Compress -Depth 3))
  [Console]::Out.Flush()
}

# Ends when the extension closes stdin (VS Code quitting or the extension stopping).
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $cmd, $arg = $line -split ' ', 2
  try { Reply @{ ok = $true; value = (Invoke-Backbeat $cmd $arg) } }
  catch { Reply @{ ok = $false; error = $_.Exception.Message } }
}
