import { MidiEvent, MidiMessageKind } from '../models/domain.models';

export interface MidiTestMessage {
  kind: MidiMessageKind;
  channel: number;
  data1: number;
  data2: number;
}

export function midiTestBytes(test: MidiTestMessage): number[] {
  const channel = Math.max(1, Math.min(16, test.channel)) - 1;

  if (test.kind === 'program-change') {
    return [0xc0 | channel, Math.max(0, Math.min(127, test.data1))];
  }

  if (test.kind === 'control-change') {
    return [0xb0 | channel, Math.max(0, Math.min(127, test.data1)), Math.max(0, Math.min(127, test.data2))];
  }

  return [0xf8];
}

export function midiEventBytes(event: MidiEvent): number[] | null {
  const channel = Math.max(1, Math.min(16, event.channel)) - 1;

  if (event.kind === 'program-change') {
    return [0xc0 | channel, Math.max(0, Math.min(127, event.data1))];
  }

  if (event.kind === 'control-change') {
    return [0xb0 | channel, Math.max(0, Math.min(127, event.data1)), Math.max(0, Math.min(127, event.data2 ?? 0))];
  }

  return event.rawBytes?.length ? [...event.rawBytes] : null;
}

export function formatMidiBytes(bytes: number[]): string {
  return bytes.map((value) => value.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

export function decodeMidiMessage(bytes: number[]): string {
  if (!bytes.length) {
    return 'Empty MIDI message';
  }

  const status = bytes[0];
  const messageType = status & 0xf0;
  const channel = (status & 0x0f) + 1;

  if (messageType === 0xc0) {
    const program = bytes[1] ?? 0;
    return `Program Change · Ch ${channel} · Program ${program}`;
  }

  if (messageType === 0xb0) {
    const controller = bytes[1] ?? 0;
    const value = bytes[2] ?? 0;
    return `Control Change · Ch ${channel} · CC ${controller} · Value ${value}`;
  }

  if (messageType === 0x90) {
    const note = bytes[1] ?? 0;
    const velocity = bytes[2] ?? 0;

    if (velocity === 0) {
      return `Note Off · Ch ${channel} · Note ${note}`;
    }

    return `Note On · Ch ${channel} · Note ${note} · Velocity ${velocity}`;
  }

  if (messageType === 0x80) {
    const note = bytes[1] ?? 0;
    const velocity = bytes[2] ?? 0;
    return `Note Off · Ch ${channel} · Note ${note} · Velocity ${velocity}`;
  }

  if (messageType === 0xe0) {
    const lsb = bytes[1] ?? 0;
    const msb = bytes[2] ?? 0;
    const value = (msb << 7) | lsb;
    return `Pitch Bend · Ch ${channel} · Value ${value}`;
  }

  if (messageType === 0xd0) {
    const pressure = bytes[1] ?? 0;
    return `Channel Pressure · Ch ${channel} · Value ${pressure}`;
  }

  if (messageType === 0xa0) {
    const note = bytes[1] ?? 0;
    const pressure = bytes[2] ?? 0;
    return `Poly Pressure · Ch ${channel} · Note ${note} · Value ${pressure}`;
  }

  if (status >= 0xf0) {
    return `System MIDI · ${formatMidiBytes(bytes)}`;
  }

  return `Unknown MIDI · ${formatMidiBytes(bytes)}`;
}

export function formatMidiInputTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  });
}
