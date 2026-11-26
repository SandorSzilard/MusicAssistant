import { Injectable, computed, inject, signal } from '@angular/core';
import { Playlist, PlaylistEntry, Song } from '../models/domain.models';
import { LibraryService } from './library.service';

export type LivePlaybackState = 'ready' | 'loading' | 'counting-in' | 'playing' | 'paused' | 'between-songs' | 'finished' | 'error';

@Injectable({ providedIn: 'root' })
export class LiveStateService {
  private readonly library = inject(LibraryService);

  readonly playlist = signal<Playlist>({
    schemaVersion: 1,
    id: 'default-playlist',
    name: 'Live Set',
    pauseBetweenSongsEnabled: false,
    pauseBetweenSongsSeconds: 5,
    entries: []
  });
  readonly liveCurrentIndex = signal(0);
  readonly livePlaybackState = signal<LivePlaybackState>('ready');
  readonly liveCurrentTime = signal(0);
  readonly liveCountdownSeconds = signal<number | null>(null);
  readonly liveActiveEntryId = signal<string | null>(null);
  readonly recoveryDialog = signal<{
    title: string;
    message: string;
    entry: PlaylistEntry | null;
    kind: 'missing' | 'invalid' | 'info';
  } | null>(null);
  readonly playlistSongs = computed<Array<{ entry: PlaylistEntry; song: Song | null }>>(() => {
    const songs = this.library.songs();
    return this.playlist().entries.map((entry) => ({
      entry,
      song: songs.find((item) => item.id === entry.songId) ?? null
    }));
  });
  readonly currentEntry = computed(() => this.playlist().entries[this.liveCurrentIndex()] ?? null);
  readonly currentSong = computed(() => {
    const songId = this.currentEntry()?.songId;
    return songId ? this.library.songs().find((song) => song.id === songId) ?? null : null;
  });
  readonly nextSong = computed(() => {
    const nextEntry = this.playlist().entries[this.liveCurrentIndex() + 1];
    return nextEntry ? this.library.songs().find((song) => song.id === nextEntry.songId) ?? null : null;
  });
  readonly loudnessTargetLufs = computed(() => {
    const values = this.playlistSongs()
      .map((item) => item.song?.loudnessLufs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
    return values.length ? Math.min(...values) : null;
  });

  hasValidLoudness(song: Song): boolean {
    return typeof song.loudnessLufs === 'number' && Number.isFinite(song.loudnessLufs);
  }

  loudnessGainDb(song: Song): number | null {
    const target = this.loudnessTargetLufs();
    if (target == null || !this.hasValidLoudness(song)) {
      return null;
    }
    return Math.min(0, target - song.loudnessLufs!);
  }

  isSongInPlaylist(songId: string): boolean {
    return this.playlist().entries.some((entry) => entry.songId === songId);
  }
}
