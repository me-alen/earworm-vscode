#!/usr/bin/env python3
"""A stand-in for Spotify's Linux MPRIS service, used by test/linux.integration.test.ts in CI.

Mimics the real app's known gaps: Shuffle/LoopStatus/Volume writes are ignored and Volume reads 0.
Needs python3-dbus and python3-gi.
"""
import dbus
import dbus.service
from dbus.mainloop.glib import DBusGMainLoop
from gi.repository import GLib

PLAYER = 'org.mpris.MediaPlayer2.Player'
TRACKS = [
    ('Say "Hi"', ['Artist A', 'Artist B'], 'Album One'),
    ('Second', ['Solo'], 'Album Two'),
]


class Spotify(dbus.service.Object):
    def __init__(self, bus):
        super().__init__(bus, '/org/mpris/MediaPlayer2')
        self.playing = False
        self.index = 0

    def props(self):
        title, artists, album = TRACKS[self.index]
        return {
            'PlaybackStatus': 'Playing' if self.playing else 'Paused',
            'Metadata': dbus.Dictionary({
                'mpris:trackid': dbus.ObjectPath(f'/com/spotify/track/{self.index}'),
                'xesam:title': title,
                'xesam:artist': dbus.Array(artists, signature='s'),
                'xesam:album': album,
            }, signature='sv'),
            'Shuffle': False,
            'LoopStatus': 'None',
            'Volume': 0.0,
        }

    @dbus.service.method(PLAYER)
    def PlayPause(self):
        self.playing = not self.playing

    @dbus.service.method(PLAYER)
    def Next(self):
        self.index = (self.index + 1) % len(TRACKS)

    @dbus.service.method(PLAYER)
    def Previous(self):
        self.index = (self.index - 1) % len(TRACKS)

    @dbus.service.method(dbus.PROPERTIES_IFACE, in_signature='ss', out_signature='v')
    def Get(self, interface, prop):
        return self.props()[prop]

    @dbus.service.method(dbus.PROPERTIES_IFACE, in_signature='s', out_signature='a{sv}')
    def GetAll(self, interface):
        return self.props()

    @dbus.service.method(dbus.PROPERTIES_IFACE, in_signature='ssv')
    def Set(self, interface, prop, value):
        pass  # like Spotify: accepted, then ignored


DBusGMainLoop(set_as_default=True)
bus = dbus.SessionBus()
name = dbus.service.BusName('org.mpris.MediaPlayer2.spotify', bus)  # held for the process lifetime
player = Spotify(bus)
GLib.MainLoop().run()
