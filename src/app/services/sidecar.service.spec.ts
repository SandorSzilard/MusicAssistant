import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendService } from './backend.service';
import { SidecarService } from './sidecar.service';
import { createSong } from '../testing/song.fixture';

describe('SidecarService', () => {
  const backend = {
    readText: vi.fn<(path: string) => Promise<string>>(),
    saveText: vi.fn<(path: string, content: string) => Promise<void>>()
  };

  beforeEach(() => {
    backend.readText.mockReset();
    backend.saveText.mockReset();
    TestBed.configureTestingModule({
      providers: [SidecarService, { provide: BackendService, useValue: backend }]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('loads schema-1 sidecars only when the source fingerprint matches', async () => {
    const service = TestBed.inject(SidecarService);
    const song = createSong();
    const sidecar = service.build(song);
    backend.readText.mockResolvedValue(JSON.stringify(sidecar));

    await expect(service.load(song)).resolves.toEqual(sidecar);
    expect(backend.readText).toHaveBeenCalledWith(`${song.sourcePath}.masidecar`);

    backend.readText.mockResolvedValue(JSON.stringify({
      ...sidecar,
      audioIdentity: { ...sidecar.audioIdentity, sha256: 'different-audio' }
    }));
    await expect(service.load(song)).resolves.toBeNull();

    backend.readText.mockResolvedValue(JSON.stringify({ ...sidecar, schemaVersion: 2 }));
    await expect(service.load(song)).resolves.toBeNull();
  });

  it('treats malformed sidecars as unusable and refuses unfingerprinted songs', async () => {
    const service = TestBed.inject(SidecarService);
    backend.readText.mockResolvedValue('{');
    await expect(service.load(createSong())).resolves.toBeNull();
    await expect(service.load(createSong({ fingerprintSha256: undefined }))).rejects.toThrow('fingerprinted');
  });

  it('round-trips corrected regional beats, chords, and MIDI anchors', async () => {
    const service = TestBed.inject(SidecarService);
    const corrected = createSong({
      beats: [
        { id: 'beat-0', index: 0, timestampSeconds: 0 },
        { id: 'regional-beat-0-0.500000', index: 1, timestampSeconds: 0.5 },
        { id: 'beat-3', index: 2, timestampSeconds: 1.5 }
      ],
      chords: [
        { id: 'regional-chord-1-0.500000', beatId: 'regional-beat-0-0.500000', beatIndex: 1, canonicalChord: 'Am', spanBeats: 1 }
      ],
      midiEvents: [{
        id: 'midi-region',
        anchorBeatId: 'regional-beat-0-0.500000',
        anchorChordId: 'regional-chord-1-0.500000',
        offsetMs: 20,
        kind: 'control-change',
        channel: 2,
        data1: 10,
        data2: 64
      }]
    });
    const sidecar = service.build(corrected);
    backend.readText.mockResolvedValue(JSON.stringify(sidecar));

    await expect(service.load(corrected)).resolves.toEqual(sidecar);
  });
});
