import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MidiMessageKind } from '../models/domain.models';
import { decodeMidiMessage, formatMidiBytes, formatMidiInputTime } from '../utils/midi.util';
import { MidiDeviceService } from '../services/midi-device.service';

@Component({
  selector: 'app-midi-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './midi-page.component.html',
  styleUrl: './midi-page.component.css'
})
export class MidiPageComponent {
  private readonly midiDevices = inject(MidiDeviceService);

  readonly midiOutputs = this.midiDevices.midiOutputs;
  readonly activeMidiDevice = this.midiDevices.activeMidiDevice;
  readonly timingCompensationMs = computed(() => this.midiDevices.midiDeviceTimingMs(this.activeMidiDevice()));
  readonly midiInputs = this.midiDevices.midiInputs;
  readonly activeMidiInputDevice = this.midiDevices.activeMidiInputDevice;
  readonly midiInputListening = this.midiDevices.midiInputListening;
  readonly midiInputMessages = this.midiDevices.midiInputMessages;

  midiKind: MidiMessageKind = 'program-change';
  midiChannel = 1;
  midiData1 = 0;
  midiData2 = 127;

  readonly formatMidiBytes = formatMidiBytes;
  readonly decodeMidiMessage = decodeMidiMessage;
  readonly formatMidiInputTime = formatMidiInputTime;

  refreshDevices(): void {
    void this.midiDevices.refreshDevices();
  }

  setOutputDevice(deviceName: string): void {
    this.midiDevices.setActiveMidiDevice(deviceName);
  }

  setTimingCompensation(value: number): void {
    this.midiDevices.setMidiDeviceTimingMs(this.activeMidiDevice(), value);
  }

  setInputDevice(deviceName: string): void {
    this.midiDevices.setActiveMidiInputDevice(deviceName);
  }

  sendMidiTest(): void {
    void this.midiDevices.sendMidiTest({
      kind: this.midiKind,
      channel: this.midiChannel,
      data1: this.midiData1,
      data2: this.midiData2
    });
  }

  startListening(): void {
    void this.midiDevices.startMidiInputListening();
  }

  stopListening(): void {
    void this.midiDevices.stopMidiInputListening();
  }

  clearMessages(): void {
    this.midiDevices.clearMidiInputMessages();
  }

  copyInputMessage(bytes: number[]): void {
    void this.midiDevices.copyMidiInputMessage(bytes);
  }
}
