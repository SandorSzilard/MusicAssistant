import { describe, expect, it } from 'vitest';
import { createSong } from '../testing/song.fixture';
import { MidiEvent } from '../models/domain.models';
import {
  mergeRegionalBeats,
  mergeRegionalChords,
  normalizeRegionalRegion,
  reconcileRegionalMidi
} from './regional-analysis.util';

describe('regional analysis merge utilities', () => {
  it('normalizes region boundaries to canonical finite bounds', () => {
    expect(normalizeRegionalRegion(-2, 3, 10)).toEqual({ startSeconds: 0, endSeconds: 3 });
    expect(normalizeRegionalRegion(8, 20, 10)).toEqual({ startSeconds: 8, endSeconds: 10 });
    expect(normalizeRegionalRegion(4, 4.01, 10)).toBeNull();
  });

  it('replaces only beats inside the region and preserves IDs outside', () => {
    const song = createSong();
    const region = { startSeconds: 0.4, endSeconds: 1.2 };
    const beats = mergeRegionalBeats(song.beats, region, [0.5, 0.75, 1.1]);

    expect(beats.find((beat) => beat.timestampSeconds === 0)?.id).toBe('beat-0');
    expect(beats.find((beat) => beat.timestampSeconds === 1.5)?.id).toBe('beat-3');
    expect(beats.map((beat) => beat.index)).toEqual([0, 1, 2, 3, 4]);
  });

  it('preserves manual chords inside the region and reconciles anchors deterministically', () => {
    const song = createSong({
      chords: [
        { id: 'outside', beatId: 'beat-0', beatIndex: 0, canonicalChord: 'C' },
        { id: 'manual', beatId: 'beat-1', beatIndex: 1, canonicalChord: 'F#', userEdited: true }
      ],
      midiEvents: []
    });
    const region = { startSeconds: 0.4, endSeconds: 1.2 };
    const beats = mergeRegionalBeats(song.beats, region, [0.4, 0.8, 1.2]);
    const merge = mergeRegionalChords(song, region, beats, [
      { beatIndex: 1, timestampSeconds: 0.8, chord: 'G', strength: 0.8, spanBeats: 1 }
    ]);

    expect(merge.chords.find((chord) => chord.id === 'outside')?.canonicalChord).toBe('C');
    expect(merge.chords.find((chord) => chord.id === 'manual')).toMatchObject({
      canonicalChord: 'F#',
      userEdited: true
    });
    expect(merge.chords.some((chord) => chord.canonicalChord === 'G' && chord.beatIndex === 1)).toBe(false);
  });

  it('reconciles MIDI anchors by canonical timestamp and never drops events', () => {
    const midi: MidiEvent = {
      id: 'midi-1',
      anchorBeatId: 'beat-1',
      anchorChordId: 'chord-old',
      offsetMs: -12,
      kind: 'program-change',
      channel: 1,
      data1: 8
    };
    const song = createSong({ midiEvents: [midi] });
    const region = { startSeconds: 0.4, endSeconds: 1.2 };
    const beats = mergeRegionalBeats(song.beats, region, [0.4, 0.8, 1.2]);
    const reconciled = reconcileRegionalMidi(song, region, beats, []);

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({ id: 'midi-1', offsetMs: -12, data1: 8 });
    expect(reconciled[0].anchorBeatId).not.toBe('beat-1');
  });
});
