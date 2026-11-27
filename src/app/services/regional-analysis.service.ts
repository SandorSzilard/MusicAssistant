import { Injectable, inject, signal } from '@angular/core';
import { AnalysisDetectedChord, AnalysisService, AnalysisWorkerSession } from './analysis.service';
import { ApplicationStateService } from './application-state.service';
import { LibraryService } from './library.service';
import { SidecarService } from './sidecar.service';
import { BeatEvent, Song } from '../models/domain.models';
import {
  mergeRegionalBeats,
  mergeRegionalChords,
  normalizeRegionalRegion,
  reconcileRegionalMidi,
  RegionalAnalysisRegion
} from '../utils/regional-analysis.util';

export type RegionalAnalysisMode = 'beats' | 'chords' | 'both';

@Injectable({ providedIn: 'root' })
export class RegionalAnalysisService {
  private readonly analysis = inject(AnalysisService);
  private readonly appState = inject(ApplicationStateService);
  private readonly library = inject(LibraryService);
  private readonly sidecars = inject(SidecarService);

  readonly status = this.appState.status;
  readonly dialog = signal<RegionalAnalysisRegion | null>(null);
  readonly startInput = signal(0);
  readonly endInput = signal(0);
  readonly selectedRegion = signal<RegionalAnalysisRegion | null>(null);
  readonly isAnalyzing = signal(false);

  private generation = 0;
  private activeWorker: AnalysisWorkerSession | null = null;

  openDialog(song: Song, currentTime: number): void {
    const duration = song.durationSeconds ?? 0;
    const region = normalizeRegionalRegion(
      Math.max(0, currentTime - 5),
      Math.min(duration, currentTime + 5),
      duration
    ) ?? { startSeconds: 0, endSeconds: duration };

    this.dialog.set(region);
    this.startInput.set(region.startSeconds);
    this.endInput.set(region.endSeconds);
  }

  closeDialog(): void {
    this.dialog.set(null);
  }

  cancelAnalysis(): void {
    this.generation++;
    this.activeWorker?.terminate();
    this.activeWorker = null;
    this.isAnalyzing.set(false);
    this.status.set('Regional analysis cancelled.');
  }

  async analyze(mode: RegionalAnalysisMode): Promise<void> {
    const song = this.library.selectedSong();
    if (!song?.assetUrl) {
      this.status.set('No song selected.');
      return;
    }

    const region = normalizeRegionalRegion(this.startInput(), this.endInput(), song.durationSeconds);
    if (!region) {
      this.status.set('Regional analysis requires a start and end at least 0.05 seconds apart.');
      return;
    }

    this.dialog.set(null);
    this.selectedRegion.set(region);

    const generation = ++this.generation;
    this.isAnalyzing.set(true);
    this.status.set(`Re-analyzing ${mode === 'both' ? 'beats + chords' : mode} from ${region.startSeconds.toFixed(2)} to ${region.endSeconds.toFixed(2)} seconds...`);

    try {
      const buffers = await this.analysis.decodeAudio(song.assetUrl);
      if (generation !== this.generation) return;

      const worker = this.analysis.createWorker();
      this.activeWorker = worker;

      if (mode === 'chords') {
        this.requestRegionalChords(worker, generation, song, region, buffers.mono, song.detectedTuningHz ?? song.sourceTuningHz ?? 440);
        return;
      }

      let correctedBeatsForBoth: BeatEvent[] = [];

      worker.onmessage = (data) => {
        if (generation !== this.generation) {
          worker.terminate();
          return;
        }

        if (data.type === 'regional-rhythm-result') {
          const oldSong = this.library.songs().find((item) => item.id === song.id);
          if (!oldSong) {
            worker.terminate();
            this.finish(false);
            return;
          }

          const correctedBeats = mergeRegionalBeats(oldSong.beats, region, data.ticks);
          let newChords = oldSong.chords;
          let beatConflictCount = 0;

          if (mode === 'beats') {
            const merge = mergeRegionalChords(oldSong, region, correctedBeats, null);
            newChords = merge.chords;
            beatConflictCount = merge.manualChordConflicts;
          }

          if (mode === 'beats') {
            const midiEvents = reconcileRegionalMidi(oldSong, region, correctedBeats, newChords);
            const updated: Song = {
              ...oldSong,
              beats: correctedBeats,
              chords: newChords,
              midiEvents,
              analysisState: 'ready'
            };
            this.applyAndSave(updated, oldSong, false);
            worker.terminate();
            this.finish(true, 'Beats corrected', beatConflictCount);
            return;
          }

          correctedBeatsForBoth = correctedBeats;
          const mono = buffers.mono.slice();
          const ticks = correctedBeats.map((beat) => beat.timestampSeconds);
          const beatIndexes = correctedBeats.map((beat) => beat.index);
          worker.postMessage(
            {
              type: 'analyze-regional-chords',
              samples: mono.buffer,
              ticks,
              beatIndexes,
              startSeconds: region.startSeconds,
              endSeconds: region.endSeconds,
              tuningFrequency: oldSong.detectedTuningHz ?? oldSong.sourceTuningHz ?? 440
            },
            [mono.buffer]
          );
          return;
        }

        if (data.type === 'regional-chords-result') {
          const oldSong = this.library.songs().find((item) => item.id === song.id);
          if (!oldSong) {
            worker.terminate();
            this.finish(false);
            return;
          }

          const merge = mergeRegionalChords(oldSong, region, correctedBeatsForBoth, data.chords);
          const midiEvents = reconcileRegionalMidi(oldSong, region, correctedBeatsForBoth, merge.chords);
          const updated: Song = {
            ...oldSong,
            beats: correctedBeatsForBoth,
            chords: merge.chords,
            midiEvents,
            analysisState: 'ready'
          };
          this.applyAndSave(updated, oldSong, merge.manualChordConflicts > 0);
          worker.terminate();
          this.finish(true, 'Beats + chords corrected', merge.manualChordConflicts);
        }

        if (data.type === 'error') {
          worker.terminate();
          this.finish(false, data.message);
        }
      };

      worker.onerror = (error) => {
        worker.terminate();
        this.finish(false, error.message);
      };

      const regionSamples = buffers.mono.slice(
        Math.floor(region.startSeconds * 44100),
        Math.ceil(region.endSeconds * 44100)
      );
      worker.postMessage(
        { type: 'analyze-regional-rhythm', samples: regionSamples.buffer, startSeconds: region.startSeconds, endSeconds: region.endSeconds },
        [regionSamples.buffer]
      );
    } catch (error) {
      this.finish(false, this.errorMessage(error));
    }
  }

  private requestRegionalChords(
    worker: AnalysisWorkerSession,
    generation: number,
    song: Song,
    region: RegionalAnalysisRegion,
    mono: Float32Array<ArrayBuffer>,
    tuningFrequency: number
  ): void {
    worker.onmessage = (data) => {
      if (generation !== this.generation) {
        worker.terminate();
        return;
      }

      if (data.type === 'regional-chords-result') {
        const oldSong = this.library.songs().find((item) => item.id === song.id);
        if (!oldSong) {
          worker.terminate();
          this.finish(false);
          return;
        }

        const merge = mergeRegionalChords(oldSong, region, oldSong.beats, data.chords);
        const midiEvents = reconcileRegionalMidi(oldSong, region, oldSong.beats, merge.chords);
        const updated: Song = {
          ...oldSong,
          chords: merge.chords,
          midiEvents,
          analysisState: 'ready'
        };

        this.applyAndSave(updated, oldSong, merge.manualChordConflicts > 0);
        worker.terminate();
        this.finish(true, 'Chords corrected', merge.manualChordConflicts);
        return;
      }

      if (data.type === 'error') {
        worker.terminate();
        this.finish(false, data.message);
      }
    };

    worker.onerror = (error) => {
      worker.terminate();
      this.finish(false, error.message);
    };

    const beforeBeat = [...song.beats].reverse().find((beat) => beat.timestampSeconds <= region.startSeconds);
    const afterBeat = song.beats.find((beat) => beat.timestampSeconds >= region.endSeconds);
    const selectedBeats = song.beats.filter((beat) =>
      beat.timestampSeconds >= region.startSeconds - 0.000001 &&
      beat.timestampSeconds <= region.endSeconds + 0.000001
    );
    const boundedBeats = [...(beforeBeat ? [beforeBeat] : []), ...selectedBeats, ...(afterBeat ? [afterBeat] : [])]
      .filter((beat, index, beats) => index === 0 || beats[index - 1].id !== beat.id)
      .sort((left, right) => left.timestampSeconds - right.timestampSeconds);
    const ticks = boundedBeats.map((beat) => beat.timestampSeconds);
    const beatIndexes = boundedBeats.map((beat) => beat.index);

    const analysisMono = mono.slice();
    worker.postMessage(
      {
        type: 'analyze-regional-chords',
        samples: analysisMono.buffer,
        ticks,
        beatIndexes,
        startSeconds: region.startSeconds,
        endSeconds: region.endSeconds,
        tuningFrequency
      },
      [analysisMono.buffer]
    );
  }

  private applyAndSave(updated: Song, oldSong: Song, conflicts: boolean): void {
    this.library.update(updated.id, {
      beats: updated.beats,
      chords: updated.chords,
      midiEvents: updated.midiEvents,
      analysisState: updated.analysisState
    });

    void this.sidecars.save(updated).catch((error) => {
      console.error(`Regional sidecar save failed for ${oldSong.fileName}:`, error);
      this.status.set(`Regional analysis applied, but sidecar save failed: ${this.errorMessage(error)}`);
    });
  }

  private finish(success: boolean, message = '', conflicts = 0): void {
    this.isAnalyzing.set(false);
    this.activeWorker = null;
    if (!success) {
      this.status.set(message ? `Regional analysis error: ${message}` : 'Regional analysis failed.');
      return;
    }

    if (conflicts > 0) {
      this.status.set(`${message}: ${conflicts} manually edited chord conflict${conflicts === 1 ? '' : 's'} reconciled to the nearest beat.`);
    } else {
      this.status.set(`${message}. Regional result saved.`);
    }
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
