import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Playlist } from '../models/domain.models';
import { BackendService } from './backend.service';
import { MusicAssistantFileService } from './music-assistant-file.service';
import { createSong } from '../testing/song.fixture';

describe('MusicAssistantFileService', () => {
  const backend = {
    readText: vi.fn<(path: string) => Promise<string>>(),
    saveText: vi.fn<(path: string, content: string) => Promise<void>>()
  };

  beforeEach(() => {
    backend.readText.mockReset();
    backend.saveText.mockReset();
    TestBed.configureTestingModule({
      providers: [MusicAssistantFileService, { provide: BackendService, useValue: backend }]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('maps playlist entries and fingerprints into the portable file format', () => {
    const service = TestBed.inject(MusicAssistantFileService);
    const song = createSong();
    const playlist: Playlist = {
      schemaVersion: 1,
      id: 'set-1',
      name: 'Set',
      pauseBetweenSongsEnabled: true,
      pauseBetweenSongsSeconds: 7,
      entries: [{
        id: 'entry-1',
        songId: song.id,
        countInEnabled: true,
        countInClicks: 2,
        midiDeviceName: 'Device',
        pauseAfterEnabled: true,
        pauseAfterSeconds: 8
      }]
    };

    expect(service.createPlaylistFile(playlist, [song])).toEqual({
      schemaVersion: 1,
      type: 'playlist',
      name: 'Set',
      playlist: {
        id: 'set-1',
        pauseBetweenSongsEnabled: true,
        pauseBetweenSongsSeconds: 7,
        entries: playlist.entries
      },
      songs: [{
        songId: song.id,
        fingerprintSha256: song.fingerprintSha256,
        fileName: song.fileName,
        sourcePath: song.sourcePath
      }]
    });
  });

  it('rejects invalid files and unresolved or unfingerprinted song references', async () => {
    const service = TestBed.inject(MusicAssistantFileService);
    backend.readText.mockResolvedValue('{');
    await expect(service.load('set.musicassistant')).rejects.toThrow('not a valid');

    backend.readText.mockResolvedValue(JSON.stringify({ schemaVersion: 2, type: 'playlist', name: 'Set', playlist: {}, songs: [] }));
    await expect(service.load('set.musicassistant')).rejects.toThrow('Unsupported');

    const playlist: Playlist = {
      schemaVersion: 1,
      id: 'set-1',
      name: 'Set',
      pauseBetweenSongsEnabled: false,
      pauseBetweenSongsSeconds: 5,
      entries: [{ id: 'entry-1', songId: 'missing' }]
    };
    expect(() => service.createPlaylistFile(playlist, [])).toThrow('not in the Library');

    expect(() => service.createPlaylistFile(
      { ...playlist, entries: [{ id: 'entry-1', songId: 'song-1' }] },
      [createSong({ fingerprintSha256: undefined })]
    )).toThrow('no fingerprint');
  });
});
