import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import { ApplicationStateService } from './application-state.service';
import { BackendService } from './backend.service';
import { MidiDeviceService } from './midi-device.service';
import { SettingsService } from './settings.service';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn()
}));

describe('MidiDeviceService resource and device recovery', () => {
  const backend = {
    listAudioOutputs: vi.fn<() => Promise<string[]>>(),
    listMidiInputs: vi.fn<() => Promise<string[]>>(),
    listMidiOutputs: vi.fn<() => Promise<string[]>>(),
    startMidiInputListener: vi.fn<(deviceName: string) => Promise<void>>(),
    stopMidiInputListener: vi.fn<() => Promise<void>>()
  };
  const settings = {
    load: vi.fn(),
    save: vi.fn()
  };

  beforeEach(() => {
    vi.mocked(listen).mockReset();
    backend.listAudioOutputs.mockReset().mockResolvedValue([]);
    backend.listMidiInputs.mockReset().mockResolvedValue([]);
    backend.listMidiOutputs.mockReset().mockResolvedValue([]);
    backend.startMidiInputListener.mockReset().mockResolvedValue(undefined);
    backend.stopMidiInputListener.mockReset().mockResolvedValue(undefined);
    settings.load.mockReset().mockResolvedValue({
      schemaVersion: 1,
      midi: { outputDevice: '', inputDevice: '', deviceTimingCompensationMs: {} },
      live: { loudnessMatchingEnabled: true }
    });
    settings.save.mockReset().mockResolvedValue(undefined);

    TestBed.configureTestingModule({
      providers: [
        MidiDeviceService,
        ApplicationStateService,
        { provide: BackendService, useValue: backend },
        { provide: SettingsService, useValue: settings }
      ]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('clears disconnected device selections and does not auto-select a reappearing device', async () => {
    const service = TestBed.inject(MidiDeviceService);
    service.activeMidiDevice.set('Output');
    service.activeMidiInputDevice.set('Input');

    await service.refreshDevices();
    expect(service.activeMidiDevice()).toBe('');
    expect(service.activeMidiInputDevice()).toBe('');

    backend.listMidiOutputs.mockResolvedValue(['Output']);
    backend.listMidiInputs.mockResolvedValue(['Input']);
    await service.refreshDevices();

    expect(service.midiOutputs()).toEqual(['Output']);
    expect(service.midiInputs()).toEqual(['Input']);
    expect(service.activeMidiDevice()).toBe('');
    expect(service.activeMidiInputDevice()).toBe('');
  });

  it('releases the event listener if the native MIDI listener fails to start', async () => {
    const service = TestBed.inject(MidiDeviceService);
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);
    backend.startMidiInputListener.mockRejectedValue(new Error('device unavailable'));
    service.activeMidiInputDevice.set('Input');

    await service.startMidiInputListening();

    expect(unlisten).toHaveBeenCalledOnce();
    expect(service.midiInputListening()).toBe(false);
    expect(TestBed.inject(ApplicationStateService).status()).toBe('Could not start MIDI input: device unavailable');
  });

  it('unregisters the event listener when MIDI monitoring is stopped', async () => {
    const service = TestBed.inject(MidiDeviceService);
    const unlisten = vi.fn();
    vi.mocked(listen).mockResolvedValue(unlisten);
    service.activeMidiInputDevice.set('Input');

    await service.startMidiInputListening();
    expect(service.midiInputListening()).toBe(true);

    await service.stopMidiInputListening();

    expect(unlisten).toHaveBeenCalledOnce();
    expect(service.midiInputListening()).toBe(false);
  });
});
