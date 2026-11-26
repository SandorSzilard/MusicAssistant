import { Injectable } from '@angular/core';
import { BackendService } from './backend.service';
import { Song, SongSidecar } from '../models/domain.models';

@Injectable({ providedIn: 'root' })
export class SidecarService {
  constructor(private readonly backend: BackendService) {}

  private readonly sidecarExtension = '.masidecar';

  sidecarPath(song: Song): string {
    return `${song.sourcePath}${this.sidecarExtension}`;
  }

  build(song: Song): SongSidecar {
    if (!song.fingerprintSha256) throw new Error('Cannot save sidecar before the source audio has been fingerprinted.');
    return {
      schemaVersion: 1,
      audioIdentity: { sha256: song.fingerprintSha256, fileNameHint: song.fileName },
      analysis: {
        bpm: song.bpm,
        tuningCents: song.tuningCents,
        loudnessLufs: song.loudnessLufs,
        beats: song.beats,
        chords: song.chords,
        waveformPeaks: song.waveformPeaks,
        detectedTuningHz: song.detectedTuningHz,
        keyTonic: song.keyTonic,
        keyMode: song.keyMode
      },
      userEdits: {
        transposeSemitones: song.transposeSemitones,
        sourceTuningHz: song.sourceTuningHz,
        tuningCorrectionEnabled: song.tuningCorrectionEnabled,
        tuningCorrectionCents: song.tuningCorrectionCents,
        startSeconds: song.startSeconds,
        endSeconds: song.endSeconds,
        countInEnabled: song.countInEnabled,
        countInClicks: song.countInClicks,
        midiEvents: song.midiEvents,
        sections: song.sections,
        tempoMultiplier: song.tempoMultiplier
      }
    };
  }

  async load(song: Song): Promise<SongSidecar | null> {
    if (!song.fingerprintSha256) {
      throw new Error('Cannot load sidecar before the source audio has been fingerprinted.');
    }

    const path = this.sidecarPath(song);

    try {
      const content = await this.backend.readText(path);

      const sidecar = JSON.parse(content) as SongSidecar;

      if (sidecar.schemaVersion !== 1) {
        return null;
      }

      if (!sidecar.audioIdentity?.sha256 || sidecar.audioIdentity.sha256 !== song.fingerprintSha256) {
        return null;
      }

      return sidecar;
    } catch {
      // Missing, unreadable, or invalid sidecar:
      // treat it as "no usable sidecar".
      return null;
    }
  }

  async save(song: Song): Promise<string> {
    const path = this.sidecarPath(song);
    await this.backend.saveText(path, JSON.stringify(this.build(song), null, 2));
    return path;
  }
}
