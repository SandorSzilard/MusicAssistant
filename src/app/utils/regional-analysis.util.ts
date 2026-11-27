import { BeatEvent, ChordEvent, MidiEvent, Song } from '../models/domain.models';

interface RegionalDetectedChord {
  beatIndex: number;
  timestampSeconds: number;
  chord: string;
  strength: number;
  spanBeats?: number;
}

export interface RegionalAnalysisRegion {
  startSeconds: number;
  endSeconds: number;
}

export interface RegionalChordMergeResult {
  chords: ChordEvent[];
  manualChordConflicts: number;
}

export interface RegionalMergeResult {
  beats: BeatEvent[];
  manualChordConflicts: number;
  midiEvents: MidiEvent[];
  chords: ChordEvent[];
}

export function normalizeRegionalRegion(
  startSeconds: number,
  endSeconds: number,
  durationSeconds: number | null | undefined
): RegionalAnalysisRegion | null {
  const finiteDuration = typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) ? durationSeconds : 0;
  const maximum = Math.max(0, finiteDuration);
  const start = Number.isFinite(startSeconds) ? Math.max(0, Math.min(maximum, startSeconds)) : 0;
  const end = Number.isFinite(endSeconds) ? Math.max(0, Math.min(maximum, endSeconds)) : 0;

  if (end <= start + 0.05) {
    return null;
  }

  return { startSeconds: start, endSeconds: end };
}

function inRegion(timestampSeconds: number, region: RegionalAnalysisRegion): boolean {
  return timestampSeconds >= region.startSeconds - 0.000001 && timestampSeconds <= region.endSeconds + 0.000001;
}

function nearestBeat(beats: BeatEvent[], timestampSeconds: number, region: RegionalAnalysisRegion): { beat: BeatEvent; distanceSeconds: number } | null {
  let nearest: BeatEvent | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const beat of beats) {
    if (!inRegion(beat.timestampSeconds, region)) {
      continue;
    }

    const distance = Math.abs(beat.timestampSeconds - timestampSeconds);
    if (distance < nearestDistance) {
      nearest = beat;
      nearestDistance = distance;
    }
  }

  return nearest ? { beat: nearest, distanceSeconds: nearestDistance } : null;
}

export function mergeRegionalBeats(
  oldBeats: BeatEvent[],
  region: RegionalAnalysisRegion,
  detectedTicks: number[],
  idPrefix = 'regional-beat'
): BeatEvent[] {
  const outside = oldBeats.filter((beat) => !inRegion(beat.timestampSeconds, region));
  const corrected = detectedTicks
    .map((timestampSeconds) => ({
      timestampSeconds: Math.max(region.startSeconds, Math.min(region.endSeconds, timestampSeconds))
    }))
    .filter((beat) => inRegion(beat.timestampSeconds, region));

  const combined = [
    ...outside.map((beat) => ({ id: beat.id, timestampSeconds: beat.timestampSeconds })),
    ...corrected.map((beat, index) => ({
      id: `${idPrefix}-${index}-${beat.timestampSeconds.toFixed(6)}`,
      timestampSeconds: beat.timestampSeconds
    }))
  ]
    .sort((left, right) => left.timestampSeconds - right.timestampSeconds)
    .filter((beat, index, beats) => index === 0 || Math.abs(beats[index - 1].timestampSeconds - beat.timestampSeconds) > 0.000001);

  return combined.map((beat, index) => ({
    id: beat.id,
    index,
    timestampSeconds: beat.timestampSeconds
  }));
}

export function mergeRegionalChords(
  oldSong: Song,
  region: RegionalAnalysisRegion,
  newBeats: BeatEvent[],
  detectedChords: RegionalDetectedChord[] | null
): RegionalChordMergeResult {
  const outside: ChordEvent[] = [];
  const manualInside: ChordEvent[] = [];
  const automaticInside: ChordEvent[] = [];

  for (const chord of oldSong.chords) {
    const oldBeat = oldSong.beats.find((beat) => beat.id === chord.beatId)
      ?? oldSong.beats[chord.beatIndex];

    if (!oldBeat || !inRegion(oldBeat.timestampSeconds, region)) {
      outside.push(chord);
    } else if (chord.userEdited) {
      manualInside.push(chord);
    } else if (detectedChords == null) {
      automaticInside.push(chord);
    }
  }

  let manualChordConflicts = 0;
  const manualByBeatId = new Map<string, ChordEvent>();
  const intervalDistances = newBeats
    .slice(1)
    .map((beat, index) => beat.timestampSeconds - newBeats[index].timestampSeconds)
    .filter((distance) => Number.isFinite(distance) && distance > 0);
  const medianInterval = intervalDistances.length
    ? [...intervalDistances].sort((left, right) => left - right)[Math.floor(intervalDistances.length / 2)]
    : 0.5;

  for (const manual of manualInside) {
    const oldBeat = oldSong.beats.find((beat) => beat.id === manual.beatId)
      ?? oldSong.beats[manual.beatIndex];
    if (!oldBeat) {
      manualChordConflicts++;
      continue;
    }

    const mapped = nearestBeat(newBeats, oldBeat.timestampSeconds, region);
    if (!mapped) {
      manualChordConflicts++;
      continue;
    }

    if (mapped.distanceSeconds > medianInterval * 0.25) {
      manualChordConflicts++;
    }

    manualByBeatId.set(mapped.beat.id, {
      ...manual,
      id: manual.id,
      beatId: mapped.beat.id,
      beatIndex: mapped.beat.index,
      userEdited: true
    });
  }

  const preservedAutomaticByBeatId = new Map<string, ChordEvent>();
  if (detectedChords == null) {
    for (const automatic of automaticInside) {
      const oldBeat = oldSong.beats.find((beat) => beat.id === automatic.beatId)
        ?? oldSong.beats[automatic.beatIndex];
      if (!oldBeat) continue;

      const mapped = nearestBeat(newBeats, oldBeat.timestampSeconds, region);
      if (!mapped) continue;

      const existingManual = manualByBeatId.has(mapped.beat.id);
      if (!existingManual) {
        preservedAutomaticByBeatId.set(mapped.beat.id, {
          ...automatic,
          beatId: mapped.beat.id,
          beatIndex: mapped.beat.index
        });
      }
    }
  }

  const detected: ChordEvent[] = [];
  for (const result of detectedChords ?? []) {
    const beat = newBeats[result.beatIndex];
    if (!beat || !inRegion(beat.timestampSeconds, region) || manualByBeatId.has(beat.id)) {
      continue;
    }

    detected.push({
      id: `regional-chord-${beat.index}-${beat.timestampSeconds.toFixed(6)}`,
      beatId: beat.id,
      beatIndex: beat.index,
      canonicalChord: result.chord,
      confidence: result.strength,
      spanBeats: result.spanBeats ?? 1
    });
  }

  const chords = [...outside, ...manualByBeatId.values(), ...preservedAutomaticByBeatId.values(), ...detected]
    .sort((left, right) => left.beatIndex - right.beatIndex);

  return {
    chords: chords.map((chord, index) => ({ ...chord, id: chord.id })),
    manualChordConflicts
  };
}

export function reconcileRegionalMidi(
  oldSong: Song,
  region: RegionalAnalysisRegion,
  newBeats: BeatEvent[],
  newChords: ChordEvent[]
): MidiEvent[] {
  return oldSong.midiEvents.map((event) => {
    const oldBeat = oldSong.beats.find((beat) => beat.id === event.anchorBeatId);

    if (!oldBeat || !inRegion(oldBeat.timestampSeconds, region)) {
      return event;
    }

    const mappedBeat = nearestBeat(newBeats, oldBeat.timestampSeconds, region)?.beat;
    if (!mappedBeat) {
      return event;
    }

    const mappedChord = newChords
      .filter((chord) => inRegion(newBeats[chord.beatIndex]?.timestampSeconds ?? -1, region))
      .reduce<ChordEvent | null>((nearest, chord) => {
        const chordTime = newBeats[chord.beatIndex]?.timestampSeconds;
        if (chordTime == null) {
          return nearest;
        }
        const chordDistance = Math.abs(chordTime - oldBeat.timestampSeconds);
        if (!nearest) {
          return chord;
        }
        const nearestTime = newBeats[nearest.beatIndex]?.timestampSeconds;
        return nearestTime != null && Math.abs(nearestTime - oldBeat.timestampSeconds) <= chordDistance ? nearest : chord;
      }, null);

    return {
      ...event,
      anchorBeatId: mappedBeat.id,
      anchorChordId: mappedChord?.id ?? event.anchorChordId
    };
  });
}
