import { Injectable, inject } from '@angular/core';
import { BackendService } from './backend.service';
import { MusicAssistantPlaylistFile, Playlist, Song } from '../models/domain.models';

@Injectable({ providedIn: 'root' })
export class MusicAssistantFileService {
  private readonly backend = inject(BackendService);

  createPlaylistFile(playlist: Playlist, songs: Song[]): MusicAssistantPlaylistFile {
    const referencedSongs = playlist.entries.map((entry) => {
      const song = songs.find((item) => item.id === entry.songId);

      if (!song) {
        throw new Error(`Playlist references a song that is not in the Library: ${entry.songId}`);
      }

      if (!song.fingerprintSha256) {
        throw new Error(`Song has no fingerprint and cannot be saved in a Music Assistant file: ${song.fileName}`);
      }

      return {
        song,
        fingerprintSha256: song.fingerprintSha256
      };
    });

    return {
      schemaVersion: 1,
      type: 'playlist',
      name: playlist.name,
      playlist: {
        id: playlist.id,
        pauseBetweenSongsEnabled: playlist.pauseBetweenSongsEnabled,
        pauseBetweenSongsSeconds: playlist.pauseBetweenSongsSeconds,
        entries: playlist.entries.map((entry) => ({
          id: entry.id,
          songId: entry.songId,
          countInEnabled: entry.countInEnabled,
          countInClicks: entry.countInClicks,
          midiDeviceName: entry.midiDeviceName,
          pauseAfterEnabled: entry.pauseAfterEnabled,
          pauseAfterSeconds: entry.pauseAfterSeconds
        }))
      },
      songs: referencedSongs.map(({ song, fingerprintSha256 }) => ({
        songId: song.id,
        fingerprintSha256,
        fileName: song.fileName,
        sourcePath: song.sourcePath
      }))
    };
  }

  async savePlaylist(path: string, playlist: Playlist, songs: Song[]): Promise<void> {
    const file = this.createPlaylistFile(playlist, songs);

    await this.backend.saveText(path, JSON.stringify(file, null, 2));
  }

  async load(path: string): Promise<MusicAssistantPlaylistFile> {
    const raw = await this.backend.readText(path);

    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error('This is not a valid Music Assistant file.');
    }

    if (!this.isPlaylistFile(parsed)) {
      throw new Error('Unsupported or invalid Music Assistant file.');
    }

    return parsed;
  }

  private isPlaylistFile(value: unknown): value is MusicAssistantPlaylistFile {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const file = value as Partial<MusicAssistantPlaylistFile>;

    return file.schemaVersion === 1 && file.type === 'playlist' && typeof file.name === 'string' && !!file.playlist && Array.isArray(file.songs);
  }
}
