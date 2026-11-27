import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { LibraryService } from './library.service';
import { LiveStateService } from './live-state.service';
import { createSong } from '../testing/song.fixture';

describe('LiveStateService loudness matching', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('targets the quietest finite song and only attenuates louder songs', () => {
    TestBed.configureTestingModule({ providers: [LibraryService, LiveStateService] });
    const library = TestBed.inject(LibraryService);
    const state = TestBed.inject(LiveStateService);
    const quiet = createSong({ id: 'quiet', loudnessLufs: -20 });
    const loud = createSong({ id: 'loud', loudnessLufs: -8 });
    const unknown = createSong({ id: 'unknown', loudnessLufs: undefined });
    library.songs.set([quiet, loud, unknown]);
    state.playlist.update((playlist) => ({
      ...playlist,
      entries: [quiet, loud, unknown].map((song) => ({ id: `entry-${song.id}`, songId: song.id }))
    }));

    expect(state.loudnessTargetLufs()).toBe(-20);
    expect(state.loudnessGainDb(quiet)).toBe(0);
    expect(state.loudnessGainDb(loud)).toBe(-12);
    expect(state.loudnessGainDb(unknown)).toBeNull();
  });

  it('has no loudness target when playlist values are non-finite or unavailable', () => {
    TestBed.configureTestingModule({ providers: [LibraryService, LiveStateService] });
    const library = TestBed.inject(LibraryService);
    const state = TestBed.inject(LiveStateService);
    const invalid = createSong({ id: 'invalid', loudnessLufs: Number.NaN });
    const unknown = createSong({ id: 'unknown', loudnessLufs: undefined });
    library.songs.set([invalid, unknown]);
    state.playlist.update((playlist) => ({
      ...playlist,
      entries: [invalid, unknown].map((song) => ({ id: `entry-${song.id}`, songId: song.id }))
    }));

    expect(state.loudnessTargetLufs()).toBeNull();
  });
});
