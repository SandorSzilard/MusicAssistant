import { describe, expect, it } from 'vitest';
import { MidiEvent } from '../models/domain.models';
import { midiEventBytes, midiTestBytes } from './midi.util';

describe('MIDI byte encoding', () => {
  it('encodes program changes with a clamped channel and program', () => {
    expect(midiTestBytes({ kind: 'program-change', channel: 16, data1: 200, data2: 0 })).toEqual([0xcf, 127]);
  });

  it('encodes control changes with clamped data bytes', () => {
    expect(midiTestBytes({ kind: 'control-change', channel: 2, data1: -1, data2: 128 })).toEqual([0xb1, 0, 127]);
  });

  it('copies raw event bytes and returns null for empty raw events', () => {
    const rawBytes = [0xf0, 0x7d, 0xf7];
    const event: MidiEvent = {
      id: 'raw-event',
      anchorBeatId: 'beat-0',
      offsetMs: 0,
      kind: 'raw',
      channel: 1,
      data1: 0,
      rawBytes
    };

    const encoded = midiEventBytes(event);

    expect(encoded).toEqual(rawBytes);
    encoded?.push(0);
    expect(rawBytes).toEqual([0xf0, 0x7d, 0xf7]);
    expect(midiEventBytes({ ...event, rawBytes: [] })).toBeNull();
  });
});
