import { Injectable, inject } from '@angular/core';
import { CdkDragDrop, moveItemInArray } from '@angular/cdk/drag-drop';
import { PlaylistEntry, Song } from '../models/domain.models';
import { ApplicationStateService } from './application-state.service';
import { BackendService } from './backend.service';
import { LibraryService } from './library.service';
import { LibraryImportService } from './library-import.service';
import { LivePlaybackService } from './live-playback.service';
import { LiveStateService } from './live-state.service';
import { MusicAssistantFileService } from './music-assistant-file.service';

@Injectable({ providedIn: 'root' })
export class LivePlaylistService {
  private readonly backend = inject(BackendService);
  private readonly library = inject(LibraryService);
  private readonly libraryImport = inject(LibraryImportService);
  private readonly musicAssistantFiles = inject(MusicAssistantFileService);
  private readonly applicationState = inject(ApplicationStateService);
  private readonly liveState = inject(LiveStateService);
  private readonly livePlayback = inject(LivePlaybackService);

  readonly playlist = this.liveState.playlist;
  readonly liveCurrentIndex = this.liveState.liveCurrentIndex;
  readonly recoveryDialog = this.liveState.recoveryDialog;
  private get status() { return this.applicationState.status; }
  private get tab() { return this.applicationState.tab; }

  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

  // Playlist editing
  addSongToPlaylist(song: Song): void {
    if (song.analysisState !== 'ready') {
      this.status.set(`${song.fileName} must be analyzed before adding it to Live.`);
      return;
    }

    const playlist = this.playlist();

    if (playlist.entries.some((entry) => entry.songId === song.id)) {
      this.status.set(`${song.fileName} is already in the Live playlist.`);
      return;
    }

    const entry: PlaylistEntry = {
      id: `${song.id}-${Date.now()}`,
      songId: song.id,
      pauseAfterEnabled: true
    };

    this.playlist.set({
      ...playlist,
      entries: [...playlist.entries, entry]
    });

    this.status.set(`Added ${song.fileName} to Live playlist.`);
  }

  reorderPlaylist(event: CdkDragDrop<PlaylistEntry[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    const playlist = this.playlist();

    const entries = [...playlist.entries];

    moveItemInArray(entries, event.previousIndex, event.currentIndex);

    this.playlist.set({
      ...playlist,
      entries
    });

    this.liveCurrentIndex.set(event.currentIndex);
  }

  // Set persistence
  async saveLivePlaylist(): Promise<void> {
    const playlist = this.playlist();

    if (!playlist.entries.length) {
      this.status.set('Live playlist is empty.');
      return;
    }

    try {
      const safeName = playlist.name.trim() || 'Live Set';

      const path = await this.backend.chooseMusicAssistantSaveFile(`${safeName}.musicassistant`);

      if (!path) {
        return;
      }

      await this.musicAssistantFiles.savePlaylist(path, playlist, this.library.songs());

      this.status.set(`Saved Live set: ${path}`);
    } catch (error) {
      this.status.set(`Could not save Live set: ${this.errorMessage(error)}`);
    }
  }

  async openLivePlaylist(): Promise<void> {
    try {
      const path = await this.backend.chooseMusicAssistantFile();

      if (!path) {
        return;
      }

      await this.openLivePlaylistFromPath(path);
    } catch (error) {
      this.status.set(`Could not open set: ${this.errorMessage(error)}`);
    }
  }

  async openLivePlaylistFromPath(path: string): Promise<void> {
    this.status.set('Opening Music Assistant set...');

    const file = await this.musicAssistantFiles.load(path);

    const resolvedSongIds = new Map<string, string>();

    for (const songRef of file.songs) {
      let song: Song | null | undefined = this.library.songs().find((item) => item.fingerprintSha256 === songRef.fingerprintSha256);

      if (!song) {
        this.status.set(`Loading ${songRef.fileName}...`);

        song = await this.libraryImport.importSongFromPath(songRef.sourcePath);
      }

      if (!song || song.fingerprintSha256 !== songRef.fingerprintSha256) {
        continue;
      }

      resolvedSongIds.set(songRef.songId, song.id);
    }

    const songRefs = new Map(file.songs.map((song) => [song.songId, song]));

    const entries: PlaylistEntry[] = file.playlist.entries.map((entry) => {
      const resolvedSongId = resolvedSongIds.get(entry.songId);
      const songRef = songRefs.get(entry.songId);

      if (resolvedSongId) {
        return {
          ...entry,
          songId: resolvedSongId,
          fileName: songRef?.fileName,
          fingerprintSha256: songRef?.fingerprintSha256,
          sourcePath: songRef?.sourcePath,
          offline: false
        };
      }

      return {
        ...entry,
        fileName: songRef?.fileName ?? entry.songId,
        fingerprintSha256: songRef?.fingerprintSha256,
        sourcePath: songRef?.sourcePath,
        offline: true
      };
    });

    this.livePlayback.stopLivePlayback();

    this.playlist.set({
      schemaVersion: 1,
      id: file.playlist.id,
      name: file.name,
      pauseBetweenSongsEnabled: file.playlist.pauseBetweenSongsEnabled,
      pauseBetweenSongsSeconds: file.playlist.pauseBetweenSongsSeconds,
      entries
    });

    this.liveCurrentIndex.set(0);
    this.tab.set('live');

    const firstOfflineEntry = entries.find((entry) => entry.offline);

    if (firstOfflineEntry) {
      this.status.set(`Opened set with missing audio: ${firstOfflineEntry.fileName ?? firstOfflineEntry.songId}`);
      this.showNextOfflineSongDialog();
    } else {
      this.status.set(`Opened set: ${file.name}`);
    }
  }

  // Offline-song recovery
  removeSongFromPlaylist(entryId: string): void {
    const playlist = this.playlist();

    const entries = playlist.entries.filter((entry) => entry.id !== entryId);

    this.playlist.set({
      ...playlist,
      entries
    });

    const maxIndex = Math.max(0, entries.length - 1);

    this.liveCurrentIndex.set(Math.min(this.liveCurrentIndex(), maxIndex));
  }

  async locateOfflinePlaylistSong(entry: PlaylistEntry): Promise<void> {
    if (!entry.fingerprintSha256) {
      this.status.set(`Cannot relink ${entry.fileName ?? entry.songId}: saved fingerprint is missing.`);
      return;
    }

    try {
      const path = await this.backend.chooseAudioReplacementFile();

      if (!path) {
        return;
      }

      this.status.set(`Checking ${entry.fileName ?? 'selected audio file'}...`);

      const hash = await this.backend.hashFile(path);

      if (hash !== entry.fingerprintSha256) {
        this.showInvalidSongDialog(entry);
        this.status.set(`Selected file does not match ${entry.fileName ?? 'the missing song'}.`);
        return;
      }

      const song = await this.libraryImport.importSongFromPath(path);

      if (!song) {
        this.status.set(`Could not import replacement file for ${entry.fileName ?? entry.songId}.`);
        return;
      }

      if (song.fingerprintSha256 !== entry.fingerprintSha256) {
        this.showInvalidSongDialog(entry);
        this.status.set(`Selected file does not match ${entry.fileName ?? 'the missing song'}.`);
        return;
      }

      const playlist = this.playlist();

      const entries = playlist.entries.map((item) =>
        item.id === entry.id
          ? {
              ...item,
              songId: song.id,
              fileName: song.fileName,
              fingerprintSha256: song.fingerprintSha256,
              sourcePath: song.sourcePath,
              offline: false
            }
          : item
      );

      this.playlist.set({
        ...playlist,
        entries
      });

      this.status.set(`Relinked ${song.fileName}.`);

      this.showNextOfflineSongDialog();
    } catch (error) {
      this.status.set(`Could not relink song: ${this.errorMessage(error)}`);
    }
  }

  async searchFolderForOfflineSong(entry: PlaylistEntry): Promise<void> {
    try {
      const folder = await this.backend.chooseFolder();

      if (!folder) {
        return;
      }

      this.closeRecoveryDialog();

      const offlineEntries = this.playlist().entries.filter((item) => item.offline && item.fingerprintSha256);

      if (!offlineEntries.length) {
        this.status.set('No missing songs to locate.');
        return;
      }

      this.status.set(`Scanning folder for ${offlineEntries.length} missing song${offlineEntries.length === 1 ? '' : 's'}...`);

      const paths = await this.backend.listAudioFilesRecursive(folder);

      if (!paths.length) {
        this.recoveryDialog.set({
          title: 'No audio files found',
          message: 'The selected folder does not contain any MP3 or WAV files.',
          entry,
          kind: 'info'
        });
        return;
      }

      const missingByFingerprint = new Map<string, PlaylistEntry>();

      for (const offlineEntry of offlineEntries) {
        if (offlineEntry.fingerprintSha256) {
          missingByFingerprint.set(offlineEntry.fingerprintSha256, offlineEntry);
        }
      }

      const matches = new Map<string, string>();

      for (let index = 0; index < paths.length; index++) {
        if (!missingByFingerprint.size) {
          break;
        }

        const path = paths[index];

        this.status.set(`Scanning audio files ${index + 1} of ${paths.length}...`);

        const hash = await this.backend.hashFile(path);

        if (missingByFingerprint.has(hash)) {
          matches.set(hash, path);
          missingByFingerprint.delete(hash);
        }
      }

      let relinkedCount = 0;

      for (const offlineEntry of offlineEntries) {
        const fingerprint = offlineEntry.fingerprintSha256;

        if (!fingerprint) {
          continue;
        }

        const matchingPath = matches.get(fingerprint);

        if (!matchingPath) {
          continue;
        }

        const song = await this.libraryImport.importSongFromPath(matchingPath);

        if (!song || song.fingerprintSha256 !== fingerprint) {
          continue;
        }

        const playlist = this.playlist();

        const entries = playlist.entries.map((item) =>
          item.id === offlineEntry.id
            ? {
                ...item,
                songId: song.id,
                fileName: song.fileName,
                fingerprintSha256: song.fingerprintSha256,
                sourcePath: song.sourcePath,
                offline: false
              }
            : item
        );

        this.playlist.set({
          ...playlist,
          entries
        });

        relinkedCount++;
      }

      const remainingOffline = this.playlist().entries.filter((item) => item.offline);

      if (!remainingOffline.length) {
        this.closeRecoveryDialog();
        this.status.set(`Relinked ${relinkedCount} missing song${relinkedCount === 1 ? '' : 's'}.`);
        return;
      }

      this.status.set(`Relinked ${relinkedCount}. ${remainingOffline.length} song${remainingOffline.length === 1 ? '' : 's'} still missing.`);

      this.showNextOfflineSongDialog();
    } catch (error) {
      this.recoveryDialog.set({
        title: 'Folder search failed',
        message: this.errorMessage(error),
        entry,
        kind: 'info'
      });

      this.status.set(`Folder search failed: ${this.errorMessage(error)}`);
    }
  }

  // Pause and count-in settings
  setPlaylistPauseEnabled(enabled: boolean): void {
    const playlist = this.playlist();

    this.playlist.set({
      ...playlist,
      pauseBetweenSongsEnabled: enabled
    });
  }

  setEntryPauseAfterEnabled(entryId: string, enabled: boolean): void {
    const playlist = this.playlist();

    const entries = playlist.entries.map((entry) =>
      entry.id === entryId
        ? {
            ...entry,
            pauseAfterEnabled: enabled
          }
        : entry
    );

    this.playlist.set({
      ...playlist,
      entries
    });
  }

  setPlaylistPauseSeconds(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    const seconds = Math.max(0, Math.min(300, Math.round(value)));

    const playlist = this.playlist();

    this.playlist.set({
      ...playlist,
      pauseBetweenSongsSeconds: seconds
    });
  }

  effectivePauseEnabled(entry: PlaylistEntry): boolean {
    return this.playlist().pauseBetweenSongsEnabled && (entry.pauseAfterEnabled ?? true);
  }

  effectivePauseSeconds(entry: PlaylistEntry): number {
    return entry.pauseAfterSeconds ?? this.playlist().pauseBetweenSongsSeconds;
  }

  effectiveCountInEnabled(entry: PlaylistEntry, song: Song): boolean {
    return entry.countInEnabled ?? song.countInEnabled;
  }

  effectiveCountInClicks(entry: PlaylistEntry, song: Song): number {
    return entry.countInClicks ?? song.countInClicks;
  }

  showMissingSongDialog(entry: PlaylistEntry): void {
    this.recoveryDialog.set({
      title: 'Audio file not found',
      message: `${entry.fileName ?? 'This song'} could not be found at its saved location.`,
      entry,
      kind: 'missing'
    });
  }

  showInvalidSongDialog(entry: PlaylistEntry): void {
    this.recoveryDialog.set({
      title: 'Wrong audio file',
      message: `The selected file does not match ${entry.fileName ?? 'the missing song'}.`,
      entry,
      kind: 'invalid'
    });
  }

  closeRecoveryDialog(): void {
    this.recoveryDialog.set(null);
  }

  private showNextOfflineSongDialog(): void {
    const nextOfflineEntry = this.playlist().entries.find((entry) => entry.offline);

    if (!nextOfflineEntry) {
      this.closeRecoveryDialog();
      return;
    }

    this.showMissingSongDialog(nextOfflineEntry);
  }
}
