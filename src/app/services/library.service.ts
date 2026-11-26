import { Injectable, computed, signal } from '@angular/core';
import { Song } from '../models/domain.models';

@Injectable({ providedIn: 'root' })
export class LibraryService {
  readonly songs = signal<Song[]>([]);
  readonly selectedSongId = signal<string | null>(null);
  readonly selectedSong = computed(() => this.songs().find(s => s.id === this.selectedSongId()) ?? null);

  add(song: Song): void {
    this.songs.update(items => [
      ...items.filter(s => s.id !== song.id),
      song
    ]);

    this.selectedSongId.set(song.id);
  }

  update(songId: string, patch: Partial<Song>): void {
    this.songs.update(items => items.map(song => song.id === songId ? { ...song, ...patch } : song));
  }

  select(songId: string): void { this.selectedSongId.set(songId); }
}
