export type AnalysisState = 'not-analyzed' | 'queued' | 'detecting-tuning' | 'awaiting-tuning-choice' | 'analyzing' | 'ready' | 'error';

export interface BeatEvent {
  id: string;
  index: number;
  timestampSeconds: number;
}

export interface ChordEvent {
  id: string;
  beatId: string;
  beatIndex: number;
  canonicalChord: string;
  confidence?: number;
  userEdited?: boolean;
  spanBeats?: number;
}

export type MidiMessageKind = 'program-change' | 'control-change' | 'raw';

export interface MidiEvent {
  id: string;
  anchorBeatId: string;
  anchorChordId?: string;
  offsetMs: number;
  deviceName?: string;
  kind: MidiMessageKind;
  channel: number;
  data1: number;
  data2?: number;
  rawBytes?: number[];
  label?: string;
}

export interface SongSection {
  id: string;
  label: string;
  color: string;
  startSeconds: number;
  endSeconds: number;
}

export interface Song {
  id: string;
  sourcePath: string;
  fileName: string;
  assetUrl?: string;
  fingerprintSha256?: string;
  durationSeconds?: number;
  bpm?: number;
  tuningCents?: number;
  loudnessLufs?: number;
  transposeSemitones: number;
  startSeconds?: number;
  endSeconds?: number;
  analysisState: AnalysisState;
  beats: BeatEvent[];
  chords: ChordEvent[];
  waveformPeaks: number[];
  midiEvents: MidiEvent[];
  sections: SongSection[];
  countInEnabled: boolean;
  countInClicks: number;
  tuningCorrectionEnabled: boolean;
  tuningCorrectionCents: number;
  detectedTuningHz: number | null;
  sourceTuningHz: number | null;
  keyTonic: string | null;
  keyMode: 'major' | 'minor' | null;
  tempoMultiplier: 0.5 | 1 | 2;
}

export interface PlaylistEntry {
  id: string;
  songId: string;

  fileName?: string;
  fingerprintSha256?: string;
  sourcePath?: string;
  offline?: boolean;

  countInEnabled?: boolean;
  countInClicks?: number;
  midiDeviceName?: string;
  pauseAfterEnabled?: boolean;
  pauseAfterSeconds?: number;
}

export interface Playlist {
  schemaVersion: 1;
  id: string;
  name: string;

  pauseBetweenSongsEnabled: boolean;
  pauseBetweenSongsSeconds: number;

  entries: PlaylistEntry[];
}

export interface SongSidecar {
  schemaVersion: 1;
  audioIdentity: {
    sha256: string;
    fileNameHint: string;
  };
  analysis: {
    bpm?: number;
    loudnessLufs?: number;
    beats: BeatEvent[];
    chords: ChordEvent[];
    detectedTuningHz: number | null;
    tuningCents?: number;
    keyTonic?: string | null;
    keyMode?: 'major' | 'minor' | null;
    waveformPeaks?: number[];
  };
  userEdits: {
    transposeSemitones: number;
    startSeconds?: number;
    endSeconds?: number;
    midiEvents: MidiEvent[];
    sections?: SongSection[];
    countInEnabled: boolean;
    countInClicks: number;
    sourceTuningHz: number | null;
    tuningCorrectionEnabled: boolean;
    tuningCorrectionCents: number;
    tempoMultiplier?: 0.5 | 1 | 2;
  };
}

export type MusicAssistantFileType = 'playlist';

export interface MusicAssistantPlaylistSongRef {
  songId: string;
  fingerprintSha256: string;
  fileName: string;
  sourcePath: string;
}

export interface MusicAssistantPlaylistEntry {
  id: string;
  songId: string;
  countInEnabled?: boolean;
  countInClicks?: number;
  midiDeviceName?: string;
  pauseAfterEnabled?: boolean;
  pauseAfterSeconds?: number;
}

export interface MusicAssistantPlaylistFile {
  schemaVersion: 1;
  type: 'playlist';
  name: string;
  playlist: {
    id: string;
    pauseBetweenSongsEnabled: boolean;
    pauseBetweenSongsSeconds: number;
    entries: MusicAssistantPlaylistEntry[];
  };
  songs: MusicAssistantPlaylistSongRef[];
}
