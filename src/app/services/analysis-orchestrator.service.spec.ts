import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalysisWorkerRequest, AnalysisWorkerResponse } from './analysis.service';
import { AnalysisService } from './analysis.service';
import { AnalysisOrchestratorService } from './analysis-orchestrator.service';
import { ApplicationStateService } from './application-state.service';
import { DspService } from './dsp.service';
import { LibraryService } from './library.service';
import { PracticeStateService } from './practice-state.service';
import { SidecarService } from './sidecar.service';
import { createSong } from '../testing/song.fixture';

class FakeAnalysisWorker {
  onmessage: ((data: AnalysisWorkerResponse) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;
  readonly messages: AnalysisWorkerRequest[] = [];
  readonly postMessage = vi.fn((message: AnalysisWorkerRequest, _transfer: Transferable[] = []) => {
    this.messages.push(message);
  });
  readonly terminate = vi.fn();

  emit(data: AnalysisWorkerResponse): void {
    this.onmessage?.(data);
  }
}

function audioBuffers() {
  return {
    mono: new Float32Array([0.1, 0.2, 0.3]),
    left: new Float32Array([0.1, 0.2, 0.3]),
    right: new Float32Array([0.1, 0.2, 0.3]),
    sampleRate: 44100
  };
}

describe('AnalysisOrchestratorService', () => {
  let workers: FakeAnalysisWorker[];
  let library: LibraryService;
  let service: AnalysisOrchestratorService;
  const sidecars = { save: vi.fn(async () => 'song.masidecar') };

  beforeEach(() => {
    workers = [];
    sidecars.save.mockReset().mockResolvedValue('song.masidecar');
    TestBed.configureTestingModule({
      providers: [
        AnalysisOrchestratorService,
        ApplicationStateService,
        LibraryService,
        PracticeStateService,
        { provide: DspService, useValue: { pause: vi.fn() } },
        {
          provide: AnalysisService,
          useValue: {
            decodeAudio: vi.fn(async () => audioBuffers()),
            createWaveformPeaks: vi.fn(() => [0, 0.5, 1]),
            createWorker: vi.fn(() => workers.shift() ?? new FakeAnalysisWorker())
          }
        },
        { provide: SidecarService, useValue: sidecars }
      ]
    });
    library = TestBed.inject(LibraryService);
    service = TestBed.inject(AnalysisOrchestratorService);
  });

  afterEach(() => TestBed.resetTestingModule());

  it('continues a normal A=440 song into full analysis without a tuning prompt', async () => {
    const worker = new FakeAnalysisWorker();
    workers.push(worker);
    const song = createSong({ id: 'normal-song', startSeconds: 5, endSeconds: 20 });
    library.add(song);

    service.requestFullAnalysis(song);
    await Promise.resolve();
    expect(worker.messages[0]?.type).toBe('analyze-tuning');

    worker.emit({ type: 'tuning-result', tuningFrequency: 440, tuningCents: 2, confidence: 0.99 });

    expect(service.tuningChoicePrompt()).toBeNull();
    expect(worker.messages[1]).toMatchObject({
      type: 'full-analysis',
      tuningFrequency: 440,
      loudnessStartSeconds: 5,
      loudnessEndSeconds: 20
    });

    worker.emit({
      type: 'full-analysis-result',
      bpm: 120,
      ticks: [0, 0.5],
      chords: [{ beatIndex: 0, timestampSeconds: 0, chord: 'C', strength: 0.9, spanBeats: 2 }],
      keyTonic: 'C',
      keyMode: 'major',
      loudnessLufs: -18,
      loudnessStartSeconds: 5,
      loudnessEndSeconds: 20
    });

    const analyzedSong = library.songs().find((item) => item.id === song.id);
    expect(analyzedSong).toMatchObject({
      analysisState: 'ready',
      bpm: 120,
      loudnessLufs: -18,
      keyTonic: 'C',
      keyMode: 'major',
      beats: [{ id: 'beat-0', timestampSeconds: 0 }, { id: 'beat-1', timestampSeconds: 0.5 }],
      chords: [{ id: 'chord-0', canonicalChord: 'C', spanBeats: 2 }]
    });
    expect(sidecars.save).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalled();
  });

  it('starts full analysis without confirmation when there are no manual chord edits', async () => {
    const worker = new FakeAnalysisWorker();
    workers.push(worker);
    const song = createSong({ id: 'unmodified-song' });
    library.add(song);

    service.requestFullAnalysis(song);
    await Promise.resolve();

    expect(service.manualChordAnalysisConfirmation()).toBeNull();
    expect(worker.messages[0]?.type).toBe('analyze-tuning');
    expect(service.isAnalyzing()).toBe(true);
  });

  it('prompts before full analysis when the song contains manually edited chords', async () => {
    const song = createSong({
      id: 'edited-song',
      chords: [{ id: 'manual-chord', beatId: 'beat-0', beatIndex: 0, canonicalChord: 'F', userEdited: true }]
    });
    library.add(song);

    service.requestFullAnalysis(song);

    expect(service.manualChordAnalysisConfirmation()).toEqual({
      songId: song.id,
      fileName: song.fileName
    });
    expect(service.isAnalyzing()).toBe(false);
  });

  it('does not mutate song state or persistence when the user cancels', () => {
    const song = createSong({
      id: 'cancelled-song',
      chords: [{ id: 'manual-chord', beatId: 'beat-0', beatIndex: 0, canonicalChord: 'F', userEdited: true }]
    });
    library.add(song);
    const before = library.songs();
    const statusBefore = service.status();

    service.requestFullAnalysis(song);
    service.cancelFullAnalysis();

    expect(service.manualChordAnalysisConfirmation()).toBeNull();
    expect(service.isAnalyzing()).toBe(false);
    expect(library.songs()).toEqual(before);
    expect(service.status()).toBe(statusBefore);
    expect(sidecars.save).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
  });

  it('proceeds after confirmation and saves fresh automatic chords as the new baseline', async () => {
    const worker = new FakeAnalysisWorker();
    workers.push(worker);
    const song = createSong({
      id: 'confirmed-song',
      chords: [{ id: 'manual-chord', beatId: 'beat-0', beatIndex: 0, canonicalChord: 'F', userEdited: true }]
    });
    library.add(song);

    service.requestFullAnalysis(song);
    expect(service.manualChordAnalysisConfirmation()).not.toBeNull();
    service.confirmFullAnalysis();
    await Promise.resolve();

    expect(service.manualChordAnalysisConfirmation()).toBeNull();
    expect(worker.messages[0]?.type).toBe('analyze-tuning');
    expect(service.isAnalyzing()).toBe(true);

    worker.emit({ type: 'tuning-result', tuningFrequency: 440, tuningCents: 2, confidence: 0.99 });
    worker.emit({
      type: 'full-analysis-result',
      bpm: 120,
      ticks: [0, 0.5],
      chords: [{ beatIndex: 0, timestampSeconds: 0, chord: 'D', strength: 0.9, spanBeats: 2 }],
      keyTonic: 'D',
      keyMode: 'major',
      loudnessLufs: -18,
      loudnessStartSeconds: 0,
      loudnessEndSeconds: 60
    });

    const analyzedSong = library.songs().find((item) => item.id === song.id);
    expect(analyzedSong?.chords).toEqual([{
      id: 'chord-0',
      beatId: 'beat-0',
      beatIndex: 0,
      canonicalChord: 'D',
      spanBeats: 2
    }]);
    expect(analyzedSong?.chords.some((chord) => chord.userEdited)).toBe(false);
    expect(sidecars.save).toHaveBeenCalledWith(analyzedSong);
  });

  it('prompts on detuned audio and continues analysis when the user keeps the original tuning', async () => {
    const worker = new FakeAnalysisWorker();
    workers.push(worker);
    const song = createSong({ id: 'detuned-song', startSeconds: 4, endSeconds: 18 });
    library.add(song);

    await service.analyzeSong(song);
    worker.emit({ type: 'tuning-result', tuningFrequency: 432, tuningCents: -32, confidence: 0.95 });

    expect(service.tuningChoicePrompt()).toMatchObject({
      songId: song.id,
      detectedHz: 432,
      tuningCents: -32
    });
    expect(worker.messages).toHaveLength(1);

    service.keepOriginalTuning();
    expect(worker.messages[1]).toMatchObject({
      type: 'full-analysis',
      tuningFrequency: 432,
      loudnessStartSeconds: 4,
      loudnessEndSeconds: 18
    });
  });

  it('ignores stale loudness results and saves only the current generation', async () => {
    const [olderWorker, latestWorker] = [new FakeAnalysisWorker(), new FakeAnalysisWorker()];
    workers.push(olderWorker, latestWorker);
    const song = createSong({ id: 'loudness-song', loudnessLufs: -8, startSeconds: 8, endSeconds: 10 });
    library.add(song);

    await Promise.all([
      service.recalculateSongLoudness(song),
      service.recalculateSongLoudness(song)
    ]);

    expect(olderWorker.messages[0]).toMatchObject({
      type: 'analyze-loudness',
      startSeconds: 8,
      endSeconds: 10
    });
    olderWorker.emit({ type: 'loudness-result', loudnessLufs: -30, startSeconds: 8, endSeconds: 10 });
    expect(library.songs().find((item) => item.id === song.id)?.loudnessLufs).toBe(-8);
    expect(olderWorker.terminate).toHaveBeenCalled();

    latestWorker.emit({ type: 'loudness-result', loudnessLufs: -12, startSeconds: 8, endSeconds: 10 });
    expect(library.songs().find((item) => item.id === song.id)?.loudnessLufs).toBe(-12);
    expect(sidecars.save).toHaveBeenCalledTimes(1);
  });
});
