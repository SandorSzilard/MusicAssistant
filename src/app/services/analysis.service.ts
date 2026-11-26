import { Injectable } from '@angular/core';
import { Song } from '../models/domain.models';

export interface AnalysisResult {
  bpm: number;
  tuningCents: number;
  loudnessLufs?: number;
  beatSeconds: number[];
  chords: string[];
}

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  /**
   * Integration boundary for Essentia.js/WASM.
   *
   * Do not move DSP work onto Angular's UI thread. The production implementation should:
   * 1. decode / obtain mono float samples,
   * 2. transfer samples to an analysis Web Worker,
   * 3. run the pinned local Essentia.js/WASM build,
   * 4. map RhythmExtractor2013 + tuning + ChordsDetectionBeats + loudness into AnalysisResult.
   */
  async analyze(_song: Song): Promise<AnalysisResult> {
    throw new Error('Essentia.js analysis worker is not wired yet. See docs/ROADMAP.md Milestone 2.');
  }
}
