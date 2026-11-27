import { Injectable, inject, signal } from '@angular/core';
import { ChordEvent, Song } from '../models/domain.models';
import { AnalysisService, AnalysisWorkerSession } from './analysis.service';
import { ApplicationStateService } from './application-state.service';
import { DspService } from './dsp.service';
import { LibraryService } from './library.service';
import { PracticeStateService } from './practice-state.service';
import { SidecarService } from './sidecar.service';

@Injectable({ providedIn: 'root' })
export class AnalysisOrchestratorService {
  private readonly analysis = inject(AnalysisService);
  private readonly applicationState = inject(ApplicationStateService);
  private readonly dsp = inject(DspService);
  private readonly library = inject(LibraryService);
  private readonly practiceState = inject(PracticeStateService);
  private readonly sidecars = inject(SidecarService);
  readonly status = this.applicationState.status;
  readonly selectedSong = this.library.selectedSong;
  readonly isPlaying = this.practiceState.isPlaying;
  readonly currentTime = this.practiceState.currentTime;
  readonly isAnalyzing = signal(false);

  readonly sourceTuningInput = signal<number | null>(null);

  readonly tuningChoicePrompt = signal<{
    songId: string;
    fileName: string;
    detectedHz: number;
    tuningCents: number;
  } | null>(null);

  readonly manualChordAnalysisConfirmation = signal<{
    songId: string;
    fileName: string;
  } | null>(null);

  private analysisQueue: Song[] = [];

  private currentAnalysisSongId: string | null = null;

  private readonly loudnessAnalysisGenerations = new Map<string, number>();

  private pendingTuningAnalysis: {
    songId: string;
    worker: AnalysisWorkerSession;
    mono: Float32Array<ArrayBuffer>;
    left: Float32Array<ArrayBuffer>;
    right: Float32Array<ArrayBuffer>;
  } | null = null;

  // Developer diagnostics
  async testRealRhythmAnalysis(): Promise<void> {
    this.isAnalyzing.set(true);
    const song = this.selectedSong();

    if (!song?.assetUrl) {
      this.status.set('No song selected.');
      return;
    }

    try {
      this.status.set('Decoding audio...');

      const { mono, sampleRate } = await this.analysis.decodeAudio(song.assetUrl);

      console.log('Decoded sample rate:', sampleRate);

      this.status.set('Analyzing song...');

      const worker = this.analysis.createWorker();

      worker.onmessage = (data) => {
        if (data.type === 'rhythm-result') {
          console.log('Detected BPM:', data.bpm);
          console.log('Detected beats:', data.ticks);

          const beats = data.ticks.map((timestampSeconds: number, index: number) => ({
            id: `beat-${index}`,
            index,
            timestampSeconds
          }));

          this.library.update(song.id, {
            bpm: data.bpm,
            beats,
            analysisState: 'ready'
          });

          this.status.set(`Detected BPM: ${Number(data.bpm).toFixed(2)} | Beats: ${beats.length}`);

          this.isAnalyzing.set(false);
          worker.terminate();
        }

        if (data.type === 'error') {
          console.error('Essentia analysis error:', data.message);
          this.status.set(`Essentia analysis error: ${data.message}`);
          this.isAnalyzing.set(false);
          worker.terminate();
        }
      };

      worker.onerror = (error) => {
        console.error('Essentia worker error:', error);
        this.status.set(`Essentia worker error: ${error.message}`);
        this.isAnalyzing.set(false);
        worker.terminate();
      };

      worker.postMessage(
        {
          type: 'analyze-rhythm',
          samples: mono.buffer
        },
        [mono.buffer]
      );
    } catch (error) {
      this.isAnalyzing.set(false);
      this.status.set(`Analysis error: ${this.errorMessage(error)}`);
    }
  }

  // Analysis orchestration
  requestFullAnalysis(song: Song): void {
    if (song.chords.some((chord) => chord.userEdited === true)) {
      this.manualChordAnalysisConfirmation.set({
        songId: song.id,
        fileName: song.fileName
      });
      return;
    }

    void this.analyzeSong(song);
  }

  confirmFullAnalysis(): void {
    const confirmation = this.manualChordAnalysisConfirmation();
    this.manualChordAnalysisConfirmation.set(null);

    if (!confirmation) {
      return;
    }

    const song = this.library.songs().find((item) => item.id === confirmation.songId);
    if (song) {
      void this.analyzeSong(song);
    }
  }

  cancelFullAnalysis(): void {
    this.manualChordAnalysisConfirmation.set(null);
  }

  async analyzeSong(song: Song, sourceTuningOverrideHz: number | null = null): Promise<void> {
    if (!song.assetUrl) {
      this.library.update(song.id, {
        analysisState: 'error'
      });

      this.status.set('Song has no audio source.');

      this.finishAnalysisQueueItem(song.id);
      return;
    }

    try {
      this.isAnalyzing.set(true);

      this.library.update(song.id, {
        analysisState: 'detecting-tuning'
      });

      this.status.set('Decoding audio...');

      const { mono, left, right } = await this.analysis.decodeAudio(song.assetUrl);

      const waveformPeaks = this.analysis.createWaveformPeaks(mono);

      const worker = this.analysis.createWorker();

      worker.onmessage = (data) => {
        if (data.type === 'tuning-result') {
          const tuningCents = Number(data.tuningCents);

          const detectedTuningHz = Number(data.tuningFrequency);

          console.log(`Tuning detected for ${song.fileName}:`, detectedTuningHz, 'Hz', tuningCents, 'cents');

          song.detectedTuningHz = detectedTuningHz;

          song.sourceTuningHz = detectedTuningHz;

          song.tuningCents = tuningCents;

          this.library.update(song.id, {
            detectedTuningHz,
            sourceTuningHz: detectedTuningHz,
            tuningCents
          });

          this.sourceTuningInput.set(Math.round(detectedTuningHz));

          const tuningNeedsAttention = Math.abs(tuningCents) >= 8;

          if (tuningNeedsAttention) {
            this.library.update(song.id, {
              analysisState: 'awaiting-tuning-choice'
            });

            this.pendingTuningAnalysis = {
              songId: song.id,
              worker,
              mono,
              left,
              right
            };

            this.tuningChoicePrompt.set({
              songId: song.id,
              fileName: song.fileName,
              detectedHz: detectedTuningHz,
              tuningCents
            });

            this.isAnalyzing.set(false);

            this.status.set(`Tuning choice required for ${song.fileName}`);

            return;
          }

          song.detectedTuningHz = detectedTuningHz;
          song.sourceTuningHz = detectedTuningHz;
          song.tuningCents = tuningCents;

          this.library.update(song.id, {
            detectedTuningHz,
            sourceTuningHz: detectedTuningHz,
            tuningCents,
            analysisState: 'analyzing'
          });

          this.status.set('Analyzing BPM and chords...');

          const loudnessStartSeconds = this.songStartSeconds(song);
          const loudnessEndSeconds = this.songEndSeconds(song);

          worker.postMessage(
            {
              type: 'full-analysis',
              samples: mono.buffer,
              left: left.buffer,
              right: right.buffer,
              tuningFrequency: detectedTuningHz,
              loudnessStartSeconds,
              loudnessEndSeconds
            },
            [mono.buffer, left.buffer, right.buffer]
          );

          return;
        }
        if (data.type === 'full-analysis-result') {
          const keyTonic = typeof data.keyTonic === 'string' ? data.keyTonic : null;

          const keyMode: 'major' | 'minor' | null = data.keyMode === 'major' || data.keyMode === 'minor' ? data.keyMode : null;

          console.log('Detected song key:', keyTonic, keyMode);

          const beats = data.ticks.map((timestampSeconds: number, index: number) => ({
            id: `beat-${index}`,
            index,
            timestampSeconds
          }));

          const chords: ChordEvent[] = data.chords.flatMap<ChordEvent>((result) => {
            const beatIndex = result.beatIndex;
            const beat = beats[beatIndex];

            if (!beat) return [];

            return [{
              id: `chord-${beatIndex}`,
              beatId: beat.id,
              beatIndex,
              canonicalChord: result.chord,
              spanBeats: result.spanBeats ?? 1
            }];
          });

          this.library.update(song.id, {
            bpm: data.bpm,
            beats,
            chords,
            waveformPeaks,

            keyTonic,
            keyMode,

            loudnessLufs: Number.isFinite(data.loudnessLufs) ? data.loudnessLufs : undefined,

            analysisState: 'ready'
          });

          const analyzedSong: Song = {
            ...song,

            bpm: data.bpm,
            beats,
            chords,
            waveformPeaks,

            keyTonic,
            keyMode,

            loudnessLufs: Number.isFinite(data.loudnessLufs) ? data.loudnessLufs : undefined,

            analysisState: 'ready'
          };

          void this.sidecars.save(analyzedSong).catch((error) => {
            console.error(`Automatic sidecar save failed for ${song.fileName}:`, error);
          });

          this.status.set(`Analysis complete: ${Math.round(data.bpm)} BPM, ${beats.length} beats, ${chords.length} chords`);

          this.isAnalyzing.set(false);
          worker.terminate();

          this.finishAnalysisQueueItem(song.id);
        }

        if (data.type === 'error') {
          this.library.update(song.id, {
            analysisState: 'error'
          });

          this.status.set(`Analysis error: ${data.message}`);
          this.isAnalyzing.set(false);
          worker.terminate();

          this.finishAnalysisQueueItem(song.id);
        }
      };

      worker.onerror = (error) => {
        this.library.update(song.id, {
          analysisState: 'error'
        });

        this.status.set(`Analysis error: ${error.message}`);
        this.isAnalyzing.set(false);
        worker.terminate();

        this.finishAnalysisQueueItem(song.id);
      };

      if (sourceTuningOverrideHz != null) {
        this.library.update(song.id, {
          sourceTuningHz: sourceTuningOverrideHz,
          analysisState: 'analyzing'
        });

        this.status.set(`Analyzing ${song.fileName} using A=${sourceTuningOverrideHz.toFixed(1)} Hz...`);

        const loudnessStartSeconds = this.songStartSeconds(song);
        const loudnessEndSeconds = this.songEndSeconds(song);

        worker.postMessage(
          {
            type: 'full-analysis',
            samples: mono.buffer,
            left: left.buffer,
            right: right.buffer,
            tuningFrequency: sourceTuningOverrideHz,
            loudnessStartSeconds,
            loudnessEndSeconds
          },
          [mono.buffer, left.buffer, right.buffer]
        );

        return;
      }

      this.status.set('Detecting tuning...');

      const tuningSamples = mono.slice();

      worker.postMessage(
        {
          type: 'analyze-tuning',
          samples: tuningSamples.buffer
        },
        [tuningSamples.buffer]
      );
    } catch (error) {
      this.library.update(song.id, {
        analysisState: 'error'
      });

      this.isAnalyzing.set(false);
      this.status.set(`Analysis error: ${this.errorMessage(error)}`);

      this.finishAnalysisQueueItem(song.id);
    }
  }

  // Loudness-only recalculation
  async recalculateSongLoudness(song: Song): Promise<void> {
    if (!song.assetUrl) {
      return;
    }

    const generation = (this.loudnessAnalysisGenerations.get(song.id) ?? 0) + 1;

    this.loudnessAnalysisGenerations.set(song.id, generation);

    try {
      const { left, right } = await this.analysis.decodeAudio(song.assetUrl);

      const worker = this.analysis.createWorker();

      worker.onmessage = (data) => {
        if (data.type === 'loudness-result') {
          if (this.loudnessAnalysisGenerations.get(song.id) !== generation) {
            console.log('Ignoring stale loudness result:', {
              song: song.fileName,
              generation
            });

            worker.terminate();
            return;
          }

          const loudnessLufs = Number(data.loudnessLufs);

          if (Number.isFinite(loudnessLufs)) {
            this.library.update(song.id, {
              loudnessLufs
            });

            const updatedSong = this.library.songs().find((item) => item.id === song.id);

            if (updatedSong) {
              void this.sidecars.save(updatedSong).catch((error) => {
                console.error(`Could not save recalculated loudness for ${song.fileName}:`, error);
              });
            }

            console.log('Loudness recalculated:', {
              song: song.fileName,
              loudnessLufs,
              startSeconds: data.startSeconds,
              endSeconds: data.endSeconds
            });
          }

          worker.terminate();
          return;
        }

        if (data.type === 'error') {
          if (this.loudnessAnalysisGenerations.get(song.id) === generation) {
            console.error(`Loudness recalculation failed for ${song.fileName}:`, data.message);
          }

          worker.terminate();
        }
      };

      worker.onerror = (error) => {
        if (this.loudnessAnalysisGenerations.get(song.id) === generation) {
          console.error(`Loudness worker failed for ${song.fileName}:`, error);
        }

        worker.terminate();
      };

      worker.postMessage(
        {
          type: 'analyze-loudness',
          left: left.buffer,
          right: right.buffer,
          startSeconds: this.songStartSeconds(song),
          endSeconds: this.songEndSeconds(song)
        },
        [left.buffer, right.buffer]
      );
    } catch (error) {
      console.error(`Could not recalculate loudness for ${song.fileName}:`, error);
    }
  }

  // Queue management
  enqueueAnalysis(song: Song): void {
    const alreadyQueued = this.analysisQueue.some((item) => item.id === song.id);

    const alreadyRunning = this.currentAnalysisSongId === song.id;

    if (alreadyQueued || alreadyRunning) {
      return;
    }

    this.library.update(song.id, {
      analysisState: 'queued'
    });

    this.analysisQueue.push(song);

    this.processNextAnalysis();
  }

  private processNextAnalysis(): void {
    if (this.currentAnalysisSongId) {
      return;
    }

    const nextSong = this.analysisQueue.shift();

    if (!nextSong) {
      return;
    }

    this.currentAnalysisSongId = nextSong.id;

    void this.analyzeSong(nextSong);
  }

  private finishAnalysisQueueItem(songId: string): void {
    if (this.currentAnalysisSongId === songId) {
      this.currentAnalysisSongId = null;
    }

    this.processNextAnalysis();
  }

  // Tuning decisions and persistence
  async saveSidecar(): Promise<void> {
    const song = this.selectedSong();
    if (!song) return;
    try {
      const path = await this.sidecars.save(song);
      this.status.set(`Saved sidecar: ${path}`);
    } catch (error) {
      this.status.set(this.errorMessage(error));
    }
  }

  tuningCorrectionCents(sourceHz: number, targetHz = 440): number {
    if (!Number.isFinite(sourceHz) || sourceHz <= 0 || !Number.isFinite(targetHz) || targetHz <= 0) {
      return 0;
    }

    return 1200 * Math.log2(targetHz / sourceHz);
  }

  onSourceTuningChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);

    this.sourceTuningInput.set(value);

    if (!this.sourceTuningIsValid()) {
      return;
    }

    const song = this.selectedSong();
    if (!song) return;

    this.library.update(song.id, {
      sourceTuningHz: Math.round(value)
    });
  }

  applyTuningCorrection(): void {
    const song = this.selectedSong();
    const sourceHz = this.sourceTuningInput();

    if (!song || sourceHz == null || !this.sourceTuningIsValid()) {
      return;
    }

    const roundedSourceHz = Math.round(sourceHz);

    const correctionCents = this.tuningCorrectionCents(roundedSourceHz, 440);

    const tuningCorrectionEnabled = Math.abs(correctionCents) >= 0.01;

    const updatedSong: Song = {
      ...song,
      sourceTuningHz: roundedSourceHz,
      tuningCorrectionEnabled,
      tuningCorrectionCents: tuningCorrectionEnabled ? correctionCents : 0,
      analysisState: 'analyzing'
    };

    this.library.update(song.id, {
      sourceTuningHz: roundedSourceHz,
      tuningCorrectionEnabled,
      tuningCorrectionCents: tuningCorrectionEnabled ? correctionCents : 0,
      analysisState: 'analyzing'
    });

    this.dsp.pause();
    this.isPlaying.set(false);
    this.currentTime.set(0);

    this.status.set(tuningCorrectionEnabled ? `Source tuning set to ${roundedSourceHz} Hz. Re-analyzing...` : 'Source tuning set to 440 Hz. Re-analyzing without tuning correction...');

    void this.sidecars.save(updatedSong).catch((error) => {
      console.error(`Failed to save tuning settings for ${song.fileName}:`, error);
    });

    void this.analyzeSong(updatedSong, roundedSourceHz);
  }

  resetTuning(): void {
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    this.dsp.pause();
    this.isPlaying.set(false);
    this.currentTime.set(0);

    this.sourceTuningInput.set(440);

    const updatedSong: Song = {
      ...song,
      sourceTuningHz: 440,
      tuningCorrectionEnabled: false,
      tuningCorrectionCents: 0,
      tuningCents: 0,
      analysisState: 'analyzing'
    };

    this.library.update(song.id, {
      sourceTuningHz: 440,
      tuningCorrectionEnabled: false,
      tuningCorrectionCents: 0,
      tuningCents: 0,
      analysisState: 'analyzing'
    });

    this.status.set('Tuning reset to A=440. Re-analyzing...');

    void this.sidecars.save(updatedSong).catch((error) => {
      console.error(`Failed to save reset tuning for ${song.fileName}:`, error);
    });

    void this.analyzeSong(updatedSong, 440);
  }

  keepOriginalTuning(): void {
    this.continueAfterTuningChoice(false);
  }

  tuneTo440(): void {
    this.continueAfterTuningChoice(true);
  }

  private continueAfterTuningChoice(tuneTo440: boolean): void {
    const prompt = this.tuningChoicePrompt();

    const pending = this.pendingTuningAnalysis;

    if (!prompt || !pending || prompt.songId !== pending.songId) {
      return;
    }

    const song = this.library.songs().find((item) => item.id === prompt.songId);

    if (!song) {
      pending.worker.terminate();

      this.pendingTuningAnalysis = null;
      this.tuningChoicePrompt.set(null);

      this.finishAnalysisQueueItem(prompt.songId);

      return;
    }

    const sourceHz = prompt.detectedHz;

    const correctionCents = tuneTo440 ? this.tuningCorrectionCents(sourceHz, 440) : 0;

    song.sourceTuningHz = sourceHz;

    song.tuningCorrectionEnabled = tuneTo440;

    song.tuningCorrectionCents = correctionCents;

    this.library.update(song.id, {
      sourceTuningHz: sourceHz,

      tuningCorrectionEnabled: tuneTo440,

      tuningCorrectionCents: correctionCents,

      analysisState: 'analyzing'
    });

    this.sourceTuningInput.set(Math.round(sourceHz));

    this.tuningChoicePrompt.set(null);

    this.pendingTuningAnalysis = null;

    this.isAnalyzing.set(true);

    this.status.set(tuneTo440 ? `Analyzing ${song.fileName} with tuning corrected to A=440...` : `Analyzing ${song.fileName} at original tuning...`);

    try {
      const loudnessStartSeconds = this.songStartSeconds(song);
      const loudnessEndSeconds = this.songEndSeconds(song);

      pending.worker.postMessage(
        {
          type: 'full-analysis',
          samples: pending.mono.buffer,
          left: pending.left.buffer,
          right: pending.right.buffer,
          tuningFrequency: sourceHz,
          loudnessStartSeconds,
          loudnessEndSeconds
        },
        [pending.mono.buffer, pending.left.buffer, pending.right.buffer]
      );
    } catch (error) {
      console.error('Failed to continue analysis after tuning choice:', error);

      pending.worker.terminate();

      this.pendingTuningAnalysis = null;
      this.tuningChoicePrompt.set(null);

      this.library.update(song.id, {
        analysisState: 'error'
      });

      this.isAnalyzing.set(false);

      this.status.set(`Analysis error: ${this.errorMessage(error)}`);

      this.finishAnalysisQueueItem(song.id);
    }
  }

  sourceTuningIsValid(): boolean {
    const value = this.sourceTuningInput();

    return value != null && Number.isFinite(value) && value >= 400 && value <= 480;
  }

  sourceTuningError(): string {
    const value = this.sourceTuningInput();

    if (value == null || !Number.isFinite(value)) {
      return 'Enter a source pitch.';
    }

    if (value < 400 || value > 480) {
      return 'Source pitch must be between 400 and 480 Hz.';
    }

    return '';
  }

//-------------------------------------- TESTING functions ---------------------------------------------
  // Worker diagnostics
  testEssentiaWorker(): void {
    const worker = this.analysis.createWorker();

    worker.onmessage = (data) => {
      console.log('Essentia worker:', data);

      const isAvailable = data.type === 'ready' && data.hasRhythmExtractor2013;
      this.status.set(`Essentia worker - RhythmExtractor2013: ${isAvailable ? 'ready' : 'missing'}`);

      worker.terminate();
    };

    worker.onerror = (error) => {
      console.error('Essentia worker error:', error);
      this.status.set(`Essentia worker error: ${error.message}`);
      worker.terminate();
    };

    worker.postMessage({ type: 'ping' });
  }

  async testChordPreview(): Promise<void> {
    const song = this.selectedSong();

    if (!song?.assetUrl) {
      this.status.set('No song selected.');
      return;
    }

    if (song.beats.length < 2) {
      this.status.set('Analyze rhythm first.');
      return;
    }

    try {
      this.isAnalyzing.set(true);
      this.status.set('Analyzing chords on detected beats...');

      const { mono } = await this.analysis.decodeAudio(song.assetUrl);

      const worker = this.analysis.createWorker();

      worker.onmessage = (data) => {
        if (data.type === 'chords-beats-result') {
          console.table(data.chords);

          const chords: ChordEvent[] = data.chords.flatMap<ChordEvent>((result) => {
            const beatIndex = result.beatIndex;
            const beat = song.beats[beatIndex];

            if (!beat) return [];

            return [{
              id: `chord-${beatIndex}`,
              beatId: beat.id,
              beatIndex,
              canonicalChord: result.chord,
              spanBeats: result.spanBeats ?? 1
            }];
          });

          this.library.update(song.id, {
            chords
          });

          this.status.set(`Chord preview loaded: ${chords.length} beat-aligned chords`);

          this.isAnalyzing.set(false);
          worker.terminate();
        }

        if (data.type === 'error') {
          console.error(data.message);

          this.status.set(`Chord analysis error: ${data.message}`);

          this.isAnalyzing.set(false);
          worker.terminate();
        }
      };

      worker.onerror = (error) => {
        console.error(error);

        this.status.set(`Chord worker error: ${error.message}`);

        this.isAnalyzing.set(false);
        worker.terminate();
      };

      worker.postMessage(
        {
          type: 'analyze-chords-beats',
          samples: mono.buffer,
          ticks: song.beats.map((beat) => beat.timestampSeconds)
        },
        [mono.buffer]
      );
    } catch (error) {
      this.isAnalyzing.set(false);

      this.status.set(`Chord analysis error: ${this.errorMessage(error)}`);
    }
  }

  async testTuningDetection(song: Song): Promise<void> {
    if (!song.assetUrl) {
      this.status.set('Song has no audio source.');
      return;
    }

    try {
      this.status.set('Detecting tuning...');

      const { mono } = await this.analysis.decodeAudio(song.assetUrl);

      const worker = this.analysis.createWorker();

      worker.onmessage = (data) => {
        if (data.type === 'tuning-result') {
          this.status.set(`Detected tuning: ${data.tuningFrequency.toFixed(1)} Hz (${data.tuningCents.toFixed(1)} cents)`);

          console.log('Tuning result:', data);

          worker.terminate();
        }

        if (data.type === 'error') {
          this.status.set(`Tuning error: ${data.message}`);

          worker.terminate();
        }
      };

      worker.onerror = (error) => {
        this.status.set(`Tuning error: ${error.message}`);

        worker.terminate();
      };

      worker.postMessage(
        {
          type: 'analyze-tuning',
          samples: mono.buffer
        },
        [mono.buffer]
      );
    } catch (error) {
      this.status.set(`Tuning error: ${this.errorMessage(error)}`);
    }
  }

  testSyntheticTuning(frequency = 432): void {
    const sampleRate = 44100;
    const durationSeconds = 10;
    const length = sampleRate * durationSeconds;

    const samples = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;

      // Fundamental + a few harmonics so it behaves more like
      // a musical tone than a perfect sine wave.
      samples[i] = 0.6 * Math.sin(2 * Math.PI * frequency * t) + 0.25 * Math.sin(2 * Math.PI * frequency * 2 * t) + 0.1 * Math.sin(2 * Math.PI * frequency * 3 * t);
    }

    const worker = this.analysis.createWorker();

    worker.onmessage = (data) => {
      console.log(`Synthetic ${frequency} Hz test:`, data);

      worker.terminate();
    };

    worker.postMessage({
      type: 'analyze-tuning',
      samples: samples.buffer
    });
  }
  // Time and error helpers
  private songStartSeconds(song: Song): number {
    const duration = song.durationSeconds ?? Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(song.startSeconds ?? 0, duration));
  }

  private songEndSeconds(song: Song): number {
    const startSeconds = this.songStartSeconds(song);
    const duration = song.durationSeconds ?? Number.POSITIVE_INFINITY;
    return Math.max(startSeconds, Math.min(song.endSeconds ?? duration, duration));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
