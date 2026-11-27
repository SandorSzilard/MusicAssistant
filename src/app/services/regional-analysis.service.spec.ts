import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisWorkerRequest, AnalysisWorkerResponse } from './analysis.service';
import { AnalysisService } from './analysis.service';
import { ApplicationStateService } from './application-state.service';
import { LibraryService } from './library.service';
import { RegionalAnalysisService } from './regional-analysis.service';
import { SidecarService } from './sidecar.service';
import { createSong } from '../testing/song.fixture';

class FakeRegionalWorker {
  onmessage: ((data: AnalysisWorkerResponse) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn<(message: AnalysisWorkerRequest, transfer?: Transferable[]) => void>();
  readonly terminate = vi.fn();

  emit(data: AnalysisWorkerResponse): void {
    this.onmessage?.(data);
  }
}

describe('RegionalAnalysisService stale-result protection', () => {
  let workers: FakeRegionalWorker[];
  let library: LibraryService;
  let sidecars: { save: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    workers = [];
    sidecars = { save: vi.fn(async () => 'song.masidecar') };
    TestBed.configureTestingModule({
      providers: [
        RegionalAnalysisService,
        ApplicationStateService,
        LibraryService,
        {
          provide: AnalysisService,
          useValue: {
            decodeAudio: vi.fn(async () => ({
              mono: new Float32Array([0.1, 0.2, 0.3]),
              left: new Float32Array([0.1, 0.2, 0.3]),
              right: new Float32Array([0.1, 0.2, 0.3]),
              sampleRate: 44100
            })),
            createWorker: vi.fn(() => {
              const worker = new FakeRegionalWorker();
              workers.push(worker);
              return worker;
            })
          }
        },
        { provide: SidecarService, useValue: sidecars }
      ]
    });
    library = TestBed.inject(LibraryService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('rejects an older regional worker result after cancellation', async () => {
    const song = createSong({ id: 'regional-stale', durationSeconds: 60 });
    library.add(song);
    const service = TestBed.inject(RegionalAnalysisService);
    service.startInput.set(10);
    service.endInput.set(20);

    await service.analyze('beats');
    const oldWorker = workers[0];
    service.cancelAnalysis();

    oldWorker.emit({
      type: 'regional-rhythm-result',
      bpm: 90,
      ticks: [10, 12, 14, 16, 18, 20]
    });

    expect(library.songs().find((item) => item.id === song.id)?.beats).toEqual(song.beats);
    expect(sidecars.save).not.toHaveBeenCalled();
  });
});
