import { Injectable, inject, signal } from '@angular/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { MidiEvent, MidiMessageKind } from '../models/domain.models';
import { formatMidiBytes } from '../utils/midi.util';
import { ApplicationStateService } from './application-state.service';
import { BackendService } from './backend.service';
import { SettingsService } from './settings.service';

export interface MidiInputMonitorMessage {
  receivedAt: number;
  timestamp: number;
  bytes: number[];
}

export interface MidiTestMessage {
  kind: MidiMessageKind;
  channel: number;
  data1: number;
  data2: number;
}

@Injectable({ providedIn: 'root' })
export class MidiDeviceService {
  private readonly backend = inject(BackendService);
  private readonly settings = inject(SettingsService);
  private readonly applicationState = inject(ApplicationStateService);
  private midiInputUnlisten: UnlistenFn | null = null;

  readonly audioOutputs = signal<string[]>([]);
  readonly midiOutputs = signal<string[]>([]);
  readonly activeMidiDevice = signal('');
  readonly midiDeviceTimingCompensation = signal<Record<string, number>>({});
  readonly midiInputs = signal<string[]>([]);
  readonly activeMidiInputDevice = signal('');
  readonly midiInputListening = signal(false);
  readonly lastMidiInputMessage = signal<{ timestamp: number; bytes: number[] } | null>(null);
  readonly midiInputMessages = signal<MidiInputMonitorMessage[]>([]);
  readonly liveLoudnessMatchingEnabled = signal(true);
  readonly formatMidiBytes = formatMidiBytes;

  async initialize(): Promise<void> {
    const settings = await this.settings.load();

    this.activeMidiDevice.set(settings.midi.outputDevice);
    this.activeMidiInputDevice.set(settings.midi.inputDevice);
    this.midiDeviceTimingCompensation.set({ ...settings.midi.deviceTimingCompensationMs });
    this.liveLoudnessMatchingEnabled.set(settings.live.loudnessMatchingEnabled);

    await this.refreshDevices();
  }

  async refreshDevices(): Promise<void> {
    try {
      this.audioOutputs.set(await this.backend.listAudioOutputs());

      const previousInputDevice = this.activeMidiInputDevice();
      const previousOutputDevice = this.activeMidiDevice();
      const midiInputs = await this.backend.listMidiInputs();
      this.midiInputs.set(midiInputs);

      const inputDisconnected = !!previousInputDevice && !midiInputs.includes(previousInputDevice);
      if (inputDisconnected) {
        this.activeMidiInputDevice.set('');
      }

      const midiOutputs = await this.backend.listMidiOutputs();
      this.midiOutputs.set(midiOutputs);

      const outputDisconnected = !!previousOutputDevice && !midiOutputs.includes(previousOutputDevice);
      if (outputDisconnected) {
        this.activeMidiDevice.set('');
      }

      if (inputDisconnected || outputDisconnected) {
        const disconnectedDevices: string[] = [];

        if (outputDisconnected) {
          disconnectedDevices.push(`MIDI output "${previousOutputDevice}"`);
        }

        if (inputDisconnected) {
          disconnectedDevices.push(`MIDI input "${previousInputDevice}"`);
        }

        this.applicationState.status.set(`${disconnectedDevices.join(' and ')} disconnected. Device selection was cleared.`);
        void this.saveGlobalSettings();
      }
    } catch (error) {
      this.applicationState.status.set(this.errorMessage(error));
    }
  }

  async sendMidiTest(test: MidiTestMessage): Promise<void> {
    const device = this.activeMidiDevice();

    if (!device) {
      this.applicationState.status.set('No MIDI output selected.');
      return;
    }

    const channel = Math.max(1, Math.min(16, test.channel)) - 1;
    let bytes: number[];

    if (test.kind === 'program-change') {
      bytes = [0xc0 | channel, Math.max(0, Math.min(127, test.data1))];
    } else if (test.kind === 'control-change') {
      bytes = [0xb0 | channel, Math.max(0, Math.min(127, test.data1)), Math.max(0, Math.min(127, test.data2))];
    } else {
      bytes = [0xf8];
    }

    try {
      await this.backend.sendMidiBytes(device, bytes);
      this.applicationState.status.set(`MIDI sent to ${device}: ${bytes.map((value) => `0x${value.toString(16).padStart(2, '0')}`).join(' ')}`);
    } catch (error) {
      this.applicationState.status.set(this.errorMessage(error));
    }
  }

  async startMidiInputListening(): Promise<void> {
    const deviceName = this.activeMidiInputDevice();

    if (!deviceName) {
      this.applicationState.status.set('No MIDI input selected.');
      return;
    }

    try {
      await this.stopMidiInputListening();

      this.midiInputUnlisten = await listen<{ timestamp: number; bytes: number[] }>('midi-input-message', (event) => {
        this.lastMidiInputMessage.set(event.payload);
        this.midiInputMessages.update((messages) => [
          ...messages.slice(-19),
          {
            receivedAt: Date.now(),
            timestamp: event.payload.timestamp,
            bytes: event.payload.bytes
          }
        ]);

        console.log('MIDI input:', {
          device: deviceName,
          timestamp: event.payload.timestamp,
          bytes: event.payload.bytes
        });
      });

      await this.backend.startMidiInputListener(deviceName);
      this.midiInputListening.set(true);
      this.applicationState.status.set(`Listening for MIDI input from ${deviceName}.`);
    } catch (error) {
      this.midiInputListening.set(false);
      this.applicationState.status.set(`Could not start MIDI input: ${this.errorMessage(error)}`);
    }
  }

  async stopMidiInputListening(): Promise<void> {
    try {
      await this.backend.stopMidiInputListener();
    } catch (error) {
      console.warn('Could not stop MIDI input listener:', error);
    }

    if (this.midiInputUnlisten) {
      this.midiInputUnlisten();
      this.midiInputUnlisten = null;
    }

    this.midiInputListening.set(false);
  }

  midiMessageToClipboardJson(bytes: number[]): string | null {
    if (!bytes.length) {
      return null;
    }

    const status = bytes[0];
    const messageType = status & 0xf0;
    const channel = (status & 0x0f) + 1;

    if (messageType === 0xc0) {
      return JSON.stringify({ kind: 'program-change', channel, data1: bytes[1] ?? 0 });
    }

    if (messageType === 0xb0) {
      return JSON.stringify({ kind: 'control-change', channel, data1: bytes[1] ?? 0, data2: bytes[2] ?? 0 });
    }

    return JSON.stringify({ kind: 'raw', channel, data1: 0, rawBytes: bytes });
  }

  async copyMidiInputMessage(bytes: number[]): Promise<void> {
    const json = this.midiMessageToClipboardJson(bytes);

    if (!json) {
      this.applicationState.status.set('Nothing to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(json);
      this.applicationState.status.set('MIDI event copied to clipboard.');
    } catch (error) {
      this.applicationState.status.set(`Could not copy MIDI event: ${this.errorMessage(error)}`);
    }
  }

  clearMidiInputMessages(): void {
    this.midiInputMessages.set([]);
    this.lastMidiInputMessage.set(null);
  }

  midiDeviceTimingMs(deviceName: string): number {
    return deviceName ? (this.midiDeviceTimingCompensation()[deviceName] ?? 0) : 0;
  }

  setMidiDeviceTimingMs(deviceName: string, value: number): void {
    if (!deviceName) {
      return;
    }

    const timingMs = Number.isFinite(value) ? Math.round(value) : 0;
    this.midiDeviceTimingCompensation.update((current) => ({ ...current, [deviceName]: timingMs }));
    void this.saveGlobalSettings();
  }

  setActiveMidiDevice(deviceName: string): void {
    this.activeMidiDevice.set(deviceName);
    void this.saveGlobalSettings();
  }

  setActiveMidiInputDevice(deviceName: string): void {
    this.activeMidiInputDevice.set(deviceName);
    void this.saveGlobalSettings();
  }

  setLiveLoudnessMatchingEnabled(enabled: boolean): void {
    this.liveLoudnessMatchingEnabled.set(enabled);
    void this.saveGlobalSettings();
  }

  async sendScheduledMidiEvent(event: MidiEvent): Promise<void> {
    const device = event.deviceName || this.activeMidiDevice();

    if (!device) {
      console.warn('Scheduled MIDI event skipped: no MIDI output selected.', event);
      return;
    }

    const bytes = this.midiEventBytes(event);

    if (!bytes?.length) {
      console.warn('Scheduled MIDI event skipped: invalid MIDI payload.', event);
      return;
    }

    try {
      await this.backend.sendMidiBytes(device, bytes);
      console.log('Scheduled MIDI sent:', {
        id: event.id,
        label: event.label,
        device,
        kind: event.kind,
        bytes
      });
    } catch (error) {
      console.error('Scheduled MIDI send failed:', { event, error });
      this.applicationState.status.set(`MIDI send failed: ${this.errorMessage(error)}`);
    }
  }

  private async saveGlobalSettings(): Promise<void> {
    try {
      await this.settings.save({
        schemaVersion: 1,
        midi: {
          outputDevice: this.activeMidiDevice(),
          inputDevice: this.activeMidiInputDevice(),
          deviceTimingCompensationMs: { ...this.midiDeviceTimingCompensation() }
        },
        live: {
          loudnessMatchingEnabled: this.liveLoudnessMatchingEnabled()
        }
      });
    } catch (error) {
      console.error('Could not save global settings:', error);
      this.applicationState.status.set(`Could not save settings: ${this.errorMessage(error)}`);
    }
  }

  private midiEventBytes(event: MidiEvent): number[] | null {
    const channel = Math.max(1, Math.min(16, event.channel)) - 1;

    if (event.kind === 'program-change') {
      return [0xc0 | channel, Math.max(0, Math.min(127, event.data1))];
    }

    if (event.kind === 'control-change') {
      return [0xb0 | channel, Math.max(0, Math.min(127, event.data1)), Math.max(0, Math.min(127, event.data2 ?? 0))];
    }

    if (event.kind === 'raw') {
      return event.rawBytes?.length ? [...event.rawBytes] : null;
    }

    return null;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
