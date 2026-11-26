const PITCHES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
const ALIASES: Record<string, number> = {
  C: 0,
  'B#': 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  Fb: 4,
  'E#': 5,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
  Cb: 11,
};

export function clampTranspose(value: number): number {
  return Math.max(-6, Math.min(6, Math.round(value)));
}

export function transposeChord(chord: string, semitones: number): string {
  if (!chord || chord.toUpperCase() === 'N.C.') return chord;
  const match = chord.match(/^([A-G](?:#|b)?)(.*)$/);
  if (!match) return chord;
  const root = match[1];
  const suffix = match[2];
  const index = ALIASES[root];
  if (index === undefined) return chord;
  const next = (index + (semitones % 12) + 12) % 12;
  const transposedRoot = PITCHES[next];

  // If this is a slash chord, transpose the bass note as well.
  const slash = suffix.match(/^(.*)\/([A-G](?:#|b)?)$/);
  if (slash) {
    const bassIndex = ALIASES[slash[2]];
    const bass = bassIndex === undefined ? slash[2] : PITCHES[(bassIndex + (semitones % 12) + 12) % 12];
    return `${transposedRoot}${slash[1]}/${bass}`;
  }
  return `${transposedRoot}${suffix}`;
}

export function inverseTransposeChord(displayedChord: string, semitones: number): string {
  return transposeChord(displayedChord, -semitones);
}

export function formatTime(seconds = 0): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

const KEY_NOTE_TO_INDEX: Record<string, number> = {
  C: 0,
  'C#': 1,
  Db: 1,
  D: 2,
  'D#': 3,
  Eb: 3,
  E: 4,
  F: 5,
  'F#': 6,
  Gb: 6,
  G: 7,
  'G#': 8,
  Ab: 8,
  A: 9,
  'A#': 10,
  Bb: 10,
  B: 11,
};

const FRIENDLY_MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const FRIENDLY_MINOR_NAMES = ['Cm', 'C#m', 'Dm', 'Ebm', 'Em', 'Fm', 'F#m', 'Gm', 'Abm', 'Am', 'Bbm', 'Bm'];

export function displaySongKey(tonic: string | null | undefined,mode: 'major' | 'minor' | null | undefined,transposeSemitones = 0,): string {
  if (!tonic || !mode) {
    return '-';
  }

  const originalIndex = KEY_NOTE_TO_INDEX[tonic];

  if (originalIndex == null) {
    return '-';
  }

  const tonicIndex = (originalIndex + transposeSemitones + 120) % 12;

  if (mode === 'major') {
    const major = FRIENDLY_MAJOR_NAMES[tonicIndex];
    const relativeMinorIndex = (tonicIndex + 9) % 12;
    const relativeMinor = FRIENDLY_MINOR_NAMES[relativeMinorIndex];

    return `${major} (${relativeMinor})`;
  }

  const minor = FRIENDLY_MINOR_NAMES[tonicIndex];
  const relativeMajorIndex = (tonicIndex + 3) % 12;
  const relativeMajor = FRIENDLY_MAJOR_NAMES[relativeMajorIndex];

  return `${minor} (${relativeMajor})`;
}
