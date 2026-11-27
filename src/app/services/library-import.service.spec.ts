import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { AnalysisOrchestratorService } from './analysis-orchestrator.service';
import { ApplicationStateService } from './application-state.service';
import { BackendService } from './backend.service';
import { LibraryImportService } from './library-import.service';
import { LibraryService } from './library.service';
import { PracticeStateService } from './practice-state.service';
import { SidecarService } from './sidecar.service';

describe('LibraryImportService', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('reports an unavailable source file without adding a partial song or queueing analysis', async () => {
    const backend = {
      hashFile: vi.fn().mockRejectedValue(new Error('Audio file is unavailable')),
      assetUrl: vi.fn()
    };
    const analysis = {
      sourceTuningInput: signal(440),
      enqueueAnalysis: vi.fn()
    };

    TestBed.configureTestingModule({
      providers: [
        LibraryImportService,
        ApplicationStateService,
        LibraryService,
        PracticeStateService,
        { provide: BackendService, useValue: backend },
        { provide: SidecarService, useValue: { load: vi.fn() } },
        { provide: AnalysisOrchestratorService, useValue: analysis }
      ]
    });

    const service = TestBed.inject(LibraryImportService);
    const library = TestBed.inject(LibraryService);
    const appState = TestBed.inject(ApplicationStateService);

    await expect(service.importSongFromPath('D:\\Music\\missing.wav')).resolves.toBeNull();

    expect(library.songs()).toEqual([]);
    expect(analysis.enqueueAnalysis).not.toHaveBeenCalled();
    expect(appState.status()).toBe('Audio file is unavailable');
  });
});
