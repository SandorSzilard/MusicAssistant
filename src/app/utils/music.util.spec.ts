import { describe, expect, it } from 'vitest';
import { inverseTransposeChord, transposeChord } from './music.util';

describe('chord transposition', () => {
  it('transposes roots and slash bass notes while preserving chord extensions', () => {
    expect(transposeChord('Cmaj7/G', 2)).toBe('Dmaj7/A');
    expect(transposeChord('N.C.', 5)).toBe('N.C.');
  });

  it('inverse-transposes a displayed edit back to the canonical pitch', () => {
    expect(inverseTransposeChord('Dmaj7/A', 2)).toBe('Cmaj7/G');
  });
});
