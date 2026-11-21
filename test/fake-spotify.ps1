# A stand-in for Spotify's Windows media session, used by test/windows.integration.test.ts in CI.
# The test runs it with a copy of powershell.exe named Spotify.exe, so both the process name
# and the media session's app id contain "Spotify". It plays no audio.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Playback.MediaPlayer, Windows.Media.Playback, ContentType = WindowsRuntime]

$global:tracks = @(
  @('Say "Hi"', 'Artist A, Artist B', 'Album One'),
  @('Second', 'Solo', 'Album Two')
)
$global:index = 0
$player = New-Object Windows.Media.Playback.MediaPlayer
$player.CommandManager.IsEnabled = $false # drive the media controls by hand
$global:smtc = $player.SystemMediaTransportControls
$smtc.IsEnabled = $true
$smtc.IsPlayEnabled = $true
$smtc.IsPauseEnabled = $true
$smtc.IsNextEnabled = $true
$smtc.IsPreviousEnabled = $true
$smtc.PlaybackStatus = 'Paused'

function global:Show-Track {
  $t = $global:tracks[$global:index]
  $u = $global:smtc.DisplayUpdater
  $u.Type = 'Music'
  $u.MusicProperties.Title = $t[0]
  $u.MusicProperties.Artist = $t[1]
  $u.MusicProperties.AlbumTitle = $t[2]
  $u.Update()
}

# Register-ObjectEvent cannot subscribe to WinRT events, and a script block handler would run
# on a thread with no PowerShell runspace. So a C# shim queues presses and the loop applies them.
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
public static class FakeButtons {
  public static readonly ConcurrentQueue<string> Pressed = new ConcurrentQueue<string>();
  static Type argsType;
  static Delegate handler; // kept alive while subscribed
  public static void OnPressed(object sender, object args) {
    Pressed.Enqueue(argsType.GetProperty("Button").GetValue(args, null).ToString());
  }
  public static void Attach(object smtc, Type smtcType) {
    var ev = smtcType.GetEvent("ButtonPressed");
    argsType = ev.EventHandlerType.GetGenericArguments()[1];
    handler = Delegate.CreateDelegate(ev.EventHandlerType, typeof(FakeButtons).GetMethod("OnPressed"));
    // EventInfo.AddEventHandler refuses WinRT events (their add method returns a token); call it directly.
    ev.GetAddMethod().Invoke(smtc, new object[] { handler });
  }
}
'@
[FakeButtons]::Attach($smtc, [Windows.Media.SystemMediaTransportControls, Windows.Media, ContentType = WindowsRuntime])
Show-Track # only now: the test starts pressing buttons as soon as the track appears

Write-Host 'Fake Spotify is up.'
$button = $null
while ($true) {
  while ([FakeButtons]::Pressed.TryDequeue([ref]$button)) {
    switch ($button) {
      'Play' { $smtc.PlaybackStatus = 'Playing' }
      'Pause' { $smtc.PlaybackStatus = 'Paused' }
      { $_ -in 'Next', 'Previous' } { $global:index = 1 - $global:index; Show-Track }
    }
  }
  Start-Sleep -Milliseconds 50
}
