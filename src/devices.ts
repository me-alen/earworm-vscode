// "Earworm: Choose Spotify Device": lists the user's Spotify Connect devices and moves
// playback to the one picked.
import * as vscode from 'vscode';
import { Device, WebApi } from './webapi';

const ICON: Record<string, string> = {
  Computer: 'device-desktop',
  Smartphone: 'device-mobile',
  Tablet: 'device-mobile',
  Speaker: 'unmute',
  TV: 'screen-full',
  CastVideo: 'screen-full',
  CastAudio: 'broadcast',
};

export async function pickDevice(web: WebApi): Promise<void> {
  const devices = await web.devices();
  if (!devices.length) {
    void vscode.window.showInformationMessage('No Spotify devices found. Open Spotify on a computer, phone or speaker, then try again.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    devices.map(d => ({
      label: `$(${ICON[d.type] ?? 'broadcast'}) ${d.name}`,
      description: [d.type, d.active && 'current device', d.restricted && 'cannot be controlled from other apps'].filter(Boolean).join(' · '),
      device: d,
    })),
    { title: 'Play on which Spotify device?', placeHolder: 'Playback moves to the device you pick' },
  );
  if (!picked) return;
  const d: Device = picked.device;
  if (d.active) return;
  if (d.restricted) throw new Error(`Spotify does not let other apps control "${d.name}".`);
  await web.transfer(d.id);
  vscode.window.setStatusBarMessage(`$(check) Playing on ${d.name}`, 4000);
}
