import { describe, expect, it } from 'vitest';
import { MidiEvent } from '../models/domain.models';
import { createSong } from '../testing/song.fixture';
import { MidiSchedulerService } from './midi-scheduler.service';

describe('MidiSchedulerService', () => {
  it('combines beat time, signed event offset, and the selected device compensation', () => {
    const scheduler = new MidiSchedulerService();
    const song = createSong();
    const event: MidiEvent = {
      id: 'midi-1',
      anchorBeatId: 'beat-1',
      offsetMs: -25,
      kind: 'program-change',
      channel: 1,
      data1: 5
    };

    expect(scheduler.triggerTime(song, event, 'Selected device', { 'Selected device': 12 })).toBe(0.487);
    expect(scheduler.triggerTime(song, { ...event, deviceName: 'Override' }, 'Selected device', { Override: -10 })).toBeCloseTo(0.465, 12);
    expect(scheduler.triggerTime(song, { ...event, anchorBeatId: 'missing' }, 'Selected device', {})).toBeNull();
  });

  it('fires due events once and rearms them after a playback seek', () => {
    const scheduler = new MidiSchedulerService();
    const event: MidiEvent = {
      id: 'midi-1',
      anchorBeatId: 'beat-1',
      offsetMs: 0,
      kind: 'program-change',
      channel: 1,
      data1: 5
    };
    const song = createSong({ midiEvents: [event] });
    const cursor = scheduler.createCursor();

    expect(scheduler.advance(song, cursor, 0.49, '', {})).toEqual([]);
    expect(scheduler.advance(song, cursor, 0.5, '', {})).toEqual([event]);
    expect(scheduler.advance(song, cursor, 0.6, '', {})).toEqual([]);
    expect(scheduler.advance(song, cursor, 0.3, '', {})).toEqual([]);
    expect(scheduler.advance(song, cursor, 0.5, '', {})).toEqual([event]);
  });
});
