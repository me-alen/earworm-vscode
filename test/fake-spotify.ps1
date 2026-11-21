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
Show-Track

$null = Register-ObjectEvent -InputObject $smtc -EventName ButtonPressed -Action {
  switch ([string]$EventArgs.Button) {
    'Play' { $global:smtc.PlaybackStatus = 'Playing' }
    'Pause' { $global:smtc.PlaybackStatus = 'Paused' }
    { $_ -in 'Next', 'Previous' } { $global:index = 1 - $global:index; Show-Track }
  }
}
Write-Host 'Fake Spotify is up.'
while ($true) { $null = Wait-Event -Timeout 1 }
