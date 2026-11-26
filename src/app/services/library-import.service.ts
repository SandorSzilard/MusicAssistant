import { Injectable, inject } from '@angular/core';
import { Song } from '../models/domain.models';
import { AnalysisOrchestratorService } from './analysis-orchestrator.service';
import { ApplicationStateService } from './application-state.service';
import { BackendService } from './backend.service';
import { LibraryService } from './library.service';
import { PracticeStateService } from './practice-state.service';
import { SidecarService } from './sidecar.service';

@Injectable({ providedIn: 'root' })
export class LibraryImportService {
  private readonly backend = inject(BackendService);
  private readonly library = inject(LibraryService);
  private readonly sidecars = inject(SidecarService);
  private readonly practiceState = inject(PracticeStateService);
  private readonly analysis = inject(AnalysisOrchestratorService);
  private readonly applicationState = inject(ApplicationStateService);

  readonly sourceTuningInput = this.analysis.sourceTuningInput;

  async importSongFromPath(path: string): Promise<Song | null> {
    this.practiceState.countInEnabled.set(false);

    try {
      this.applicationState.status.set('Hashing audio file...');
      const hash = await this.backend.hashFile(path);
      const fileName = path.split(/[\\/]/).pop() ?? path;

      const song: Song = {
        id: hash.slice(0, 16),
        sourcePath: path,
        fileName,
        assetUrl: this.backend.assetUrl(path),
        fingerprintSha256: hash,
        transposeSemitones: 0,
        countInEnabled: false,
        countInClicks: 4,
        analysisState: 'not-analyzed',
        beats: [],
        chords: [],
        waveformPeaks: [],
        midiEvents: [],
        sections: [],
        tuningCents: 0,
        tuningCorrectionEnabled: false,
        detectedTuningHz: null,
        sourceTuningHz: null,
        tuningCorrectionCents: 0,
        keyTonic: null,
        keyMode: null,
        tempoMultiplier: 1
      };

      const sidecar = await this.sidecars.load(song);

      if (sidecar) {
        song.bpm = sidecar.analysis.bpm;
        song.loudnessLufs = sidecar.analysis.loudnessLufs;
        song.beats = sidecar.analysis.beats ?? [];
        song.chords = sidecar.analysis.chords ?? [];
        song.waveformPeaks = sidecar.analysis.waveformPeaks ?? [];
        song.transposeSemitones = sidecar.userEdits.transposeSemitones ?? 0;
        song.startSeconds = sidecar.userEdits.startSeconds;
        song.endSeconds = sidecar.userEdits.endSeconds;
        song.countInEnabled = sidecar.userEdits.countInEnabled ?? false;
        song.countInClicks = sidecar.userEdits.countInClicks ?? 4;
        song.midiEvents = sidecar.userEdits.midiEvents ?? [];
        song.sections = sidecar.userEdits.sections ?? [];
        song.detectedTuningHz = sidecar.analysis.detectedTuningHz ?? null;
        song.tuningCents = sidecar.analysis.tuningCents ?? 0;
        song.sourceTuningHz = sidecar.userEdits.sourceTuningHz ?? song.detectedTuningHz;
        song.tuningCorrectionEnabled = sidecar.userEdits.tuningCorrectionEnabled ?? false;
        song.tuningCorrectionCents = sidecar.userEdits.tuningCorrectionCents ?? 0;
        song.keyTonic = sidecar.analysis.keyTonic ?? null;
        song.keyMode = sidecar.analysis.keyMode ?? null;
        song.tempoMultiplier = sidecar.userEdits.tempoMultiplier ?? 1;

        if (song.beats.length > 0 && song.chords.length > 0) {
          song.analysisState = 'ready';
        }
      }

      this.library.add(song);
      this.practiceState.activeLoopSectionId.set(null);
      this.sourceTuningInput.set(Math.round(song.sourceTuningHz ?? 440));
      this.practiceState.countInEnabled.set(song.countInEnabled);
      this.practiceState.countInClicks.set(song.countInClicks);

      setTimeout(() => {
        if (song.analysisState === 'ready') {
          this.applicationState.status.set('Loaded analysis from sidecar.');
        } else {
          this.applicationState.status.set('Imported. Starting analysis...');
          this.analysis.enqueueAnalysis(song);
        }
      }, 0);

      return song;
    } catch (error) {
      this.applicationState.status.set(error instanceof Error ? error.message : String(error));
      return null;
    }
  }
}
