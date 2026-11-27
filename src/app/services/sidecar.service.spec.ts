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
});
