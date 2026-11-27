import { Song } from '../models/domain.models';

export function createSong(overrides: Partial<Song> = {}): Song {
  return {
    id: 'song-1',
    sourcePath: 'C:\\Music\\song.wav',
    fileName: 'song.wav',
    assetUrl: 'asset://song-1',
    fingerprintSha256: 'fingerprint-song-1',
    durationSeconds: 60,
    bpm: 120,
    tuningCents: 0,
    loudnessLufs: -18,
    transposeSemitones: 0,
    startSeconds: 0,
    endSeconds: 60,
    analysisState: 'ready',
    beats: [
      { id: 'beat-0', index: 0, timestampSeconds: 0 },
      { id: 'beat-1', index: 1, timestampSeconds: 0.5 },
      { id: 'beat-2', index: 2, timestampSeconds: 1 },
      { id: 'beat-3', index: 3, timestampSeconds: 1.5 }
    ],
    chords: [
      { id: 'chord-0', beatId: 'beat-0', beatIndex: 0, canonicalChord: 'C', spanBeats: 2 }
    ],
    waveformPeaks: [0, 0.5, 1],
    midiEvents: [],
    sections: [],
    countInEnabled: false,
    countInClicks: 4,
    tuningCorrectionEnabled: false,
    tuningCorrectionCents: 0,
    detectedTuningHz: 440,
    sourceTuningHz: 440,
    keyTonic: 'C',
    keyMode: 'major',
    tempoMultiplier: 1,
    ...overrides
  };
}
