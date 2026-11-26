/// <reference lib="webworker" />

import Essentia from 'essentia.js/dist/essentia.js-core.es.js';
import { EssentiaWASM } from 'essentia.js/dist/essentia-wasm.es.js';
import EssentiaExtractor from 'essentia.js/dist/essentia.js-extractor.es.js';

const essentia = new Essentia(EssentiaWASM);
const extractor = new EssentiaExtractor(EssentiaWASM);

type DetectedChord = {
  beatIndex: number;
  timestampSeconds: number;
  chord: string;
  strength: number;
};

const ISOLATED_CHORD_KEEP_RATIO = 1.1;
const SAME_ROOT_MODE_SWITCH_RATIO = 1.2;

function basicChordIdentity(chord: string): { root: string; minor: boolean } | null {
  const match = chord.match(/^([A-G](?:#|b)?)(m)?$/);

  if (!match) {
    return null;
  }

  return {
    root: match[1],
    minor: match[2] === 'm'
  };
}

function smoothDetectedChords(chords: DetectedChord[]): DetectedChord[] {
  if (chords.length < 2) {
    return chords;
  }

  const smoothed = chords.map((chord) => ({ ...chord }));

  // Pass 1:
  // Remove isolated chord changes when the chord before and after agree.
  //
  // Example:
  // Em | F# | Em
  //       ↓
  // Em | Em | Em
  //
  // The middle chord must now be clearly stronger to survive.
  for (let i = 1; i < chords.length - 1; i++) {
    const previous = chords[i - 1];
    const current = chords[i];
    const next = chords[i + 1];

    if (previous.chord !== next.chord || current.chord === previous.chord) {
      continue;
    }

    const surroundingStrength = Math.min(previous.strength, next.strength);

    if (current.strength < surroundingStrength * ISOLATED_CHORD_KEEP_RATIO) {
      smoothed[i] = {
        ...current,
        chord: previous.chord
      };
    }
  }

  // Pass 2:
  // Stabilize major/minor ambiguity on the same root.
  //
  // Example:
  // F#m | F# | F# | D
  //
  // A change from F#m to F# now needs substantially stronger evidence.
  // Otherwise we preserve F#m.
  for (let i = 1; i < smoothed.length; i++) {
    const previous = smoothed[i - 1];
    const current = smoothed[i];

    const previousIdentity = basicChordIdentity(previous.chord);
    const currentIdentity = basicChordIdentity(current.chord);

    if (!previousIdentity || !currentIdentity) {
      continue;
    }

    const sameRoot = previousIdentity.root === currentIdentity.root;
    const differentMode = previousIdentity.minor !== currentIdentity.minor;

    if (!sameRoot || !differentMode) {
      continue;
    }

    if (current.strength < previous.strength * SAME_ROOT_MODE_SWITCH_RATIO) {
      smoothed[i] = {
        ...current,
        chord: previous.chord
      };
    }
  }

  return smoothed;
}

type MergedDetectedChord = DetectedChord & {
  spanBeats: number;
};

function mergeConsecutiveChords(chords: DetectedChord[]): MergedDetectedChord[] {
  const merged: MergedDetectedChord[] = [];

  for (const chord of chords) {
    const previous = merged[merged.length - 1];

    if (previous && previous.chord === chord.chord && chord.beatIndex === previous.beatIndex + previous.spanBeats) {
      previous.spanBeats += 1;
      previous.strength = Math.max(previous.strength, chord.strength);
      continue;
    }

    merged.push({
      ...chord,
      spanBeats: 1
    });
  }

  return merged;
}

addEventListener('message', ({ data }) => {
  if (data?.type === 'ping') {
    postMessage({
      type: 'ready',
      hasRhythmExtractor2013: typeof essentia.RhythmExtractor2013 === 'function'
    });

    return;
  }

  if (data?.type === 'analyze-rhythm') {
    try {
      const samples = new Float32Array(data.samples);

      const signal = essentia.arrayToVector(samples);

      const result = essentia.RhythmExtractor2013(signal);

      signal.delete?.();

      const ticks = essentia.vectorToArray(result.ticks);

      postMessage({
        type: 'rhythm-result',
        bpm: result.bpm,
        ticks: Array.from(ticks)
      });
    } catch (error) {
      postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (data?.type === 'analyze-chords-beats') {
    try {
      const samples = new Float32Array(data.samples);
      const ticks = data.ticks as number[];

      const sampleRate = 44100;
      const frameSize = 4096;
      const hopSize = 2048;

      if (ticks.length < 2) {
        throw new Error('At least two detected beats are required.');
      }

      const chords: Array<{
        beatIndex: number;
        timestampSeconds: number;
        chord: string;
        strength: number;
      }> = [];

      for (let beatIndex = 0; beatIndex < ticks.length - 1; beatIndex++) {
        const startSeconds = ticks[beatIndex];
        const endSeconds = ticks[beatIndex + 1];

        const startSample = Math.floor(startSeconds * sampleRate);
        const endSample = Math.min(Math.floor(endSeconds * sampleRate), samples.length);

        const hpcpFrames: Float32Array[] = [];

        for (let offset = startSample; offset + frameSize <= endSample; offset += hopSize) {
          const frame = samples.subarray(offset, offset + frameSize);

          const hpcp = extractor.hpcpExtractor(frame, sampleRate, false) as Float32Array;

          hpcpFrames.push(hpcp);
        }

        // Very short beat interval: take one frame centered on the beat.
        if (!hpcpFrames.length) {
          const center = Math.floor(((startSeconds + endSeconds) / 2) * sampleRate);

          const frameStart = Math.max(0, Math.min(samples.length - frameSize, center - Math.floor(frameSize / 2)));

          const frame = samples.subarray(frameStart, frameStart + frameSize);

          hpcpFrames.push(extractor.hpcpExtractor(frame, sampleRate, false) as Float32Array);
        }

        const medianHpcp = new Float32Array(12);

        for (let bin = 0; bin < 12; bin++) {
          const values = hpcpFrames.map((frame) => frame[bin]).sort((a, b) => a - b);

          const middle = Math.floor(values.length / 2);

          medianHpcp[bin] = values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
        }

        const hpcpVector = essentia.arrayToVector(medianHpcp);

        const result = essentia.Key(hpcpVector, 4, 12, 'tonictriad', 0.6, false, false, false);

        hpcpVector.delete?.();

        const chord = result.scale === 'minor' ? `${result.key}m` : result.key;

        chords.push({
          beatIndex,
          timestampSeconds: startSeconds,
          chord,
          strength: result.strength
        });
      }

      const smoothedChords = smoothDetectedChords(chords);
      const mergedChords = mergeConsecutiveChords(smoothedChords);

      postMessage({
        type: 'chords-beats-result',
        chords: mergedChords
      });
    } catch (error) {
      postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (data?.type === 'analyze-loudness') {
    try {
      const fullLeft = new Float32Array(data.left);
      const fullRight = new Float32Array(data.right);

      const sampleRate = 44100;
      const length = Math.min(fullLeft.length, fullRight.length);

      const requestedStartSeconds = Number(data.startSeconds ?? 0);
      const requestedEndSeconds = Number(data.endSeconds ?? length / sampleRate);

      const startSample = Math.max(0, Math.min(length, Math.floor(requestedStartSeconds * sampleRate)));

      const endSample = Math.max(startSample, Math.min(length, Math.ceil(requestedEndSeconds * sampleRate)));

      if (endSample <= startSample) {
        throw new Error('Loudness analysis range is empty.');
      }

      const left = fullLeft.slice(startSample, endSample);
      const right = fullRight.slice(startSample, endSample);

      const leftVector = essentia.arrayToVector(left);
      const rightVector = essentia.arrayToVector(right);

      const result = essentia.LoudnessEBUR128(leftVector, rightVector, 0.1, sampleRate, true);

      leftVector.delete?.();
      rightVector.delete?.();

      const loudnessLufs = Number(result.integratedLoudness);

      postMessage({
        type: 'loudness-result',
        loudnessLufs,
        startSeconds: startSample / sampleRate,
        endSeconds: endSample / sampleRate
      });
    } catch (error) {
      postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }

    return;
  }

  if (data?.type === 'full-analysis') {
    try {
      const samples = new Float32Array(data.samples);

      // -----------------------------
      // Loudness baseline
      // -----------------------------
      const fullLeft = new Float32Array(data.left);
      const fullRight = new Float32Array(data.right);

      const loudnessSampleRate = 44100;
      const loudnessLength = Math.min(fullLeft.length, fullRight.length);

      const requestedStartSeconds = Number(data.loudnessStartSeconds ?? 0);
      const requestedEndSeconds = Number(data.loudnessEndSeconds ?? loudnessLength / loudnessSampleRate);

      const loudnessStartSample = Math.max(0, Math.min(loudnessLength, Math.floor(requestedStartSeconds * loudnessSampleRate)));

      const loudnessEndSample = Math.max(loudnessStartSample, Math.min(loudnessLength, Math.ceil(requestedEndSeconds * loudnessSampleRate)));

      const left = fullLeft.slice(loudnessStartSample, loudnessEndSample);

      const right = fullRight.slice(loudnessStartSample, loudnessEndSample);

      const leftVector = essentia.arrayToVector(left);
      const rightVector = essentia.arrayToVector(right);

      const loudnessResult = essentia.LoudnessEBUR128(leftVector, rightVector, 0.1, 44100, true);

      leftVector.delete?.();
      rightVector.delete?.();

      const loudnessLufs = Number(loudnessResult.integratedLoudness);

      const tuningFrequency = Number.isFinite(data.tuningFrequency) && data.tuningFrequency > 0 ? Number(data.tuningFrequency) : 440;

      // -----------------------------
      // 1. Rhythm analysis
      // -----------------------------
      const signal = essentia.arrayToVector(samples);

      const rhythmResult = essentia.RhythmExtractor2013(signal);

      signal.delete?.();

      const ticksArray = essentia.vectorToArray(rhythmResult.ticks);
      const ticks = Array.from(ticksArray);

      if (ticks.length < 2) {
        throw new Error('Rhythm analysis did not return enough beats.');
      }

      // -----------------------------
      // 2. Chord boundaries
      //    Analyze every detected beat.
      // -----------------------------
      if (ticks.length < 2) {
        throw new Error('Not enough beat boundaries for chord analysis.');
      }

      // -----------------------------
      // 3. Chord analysis
      // -----------------------------
      const sampleRate = 44100;
      const frameSize = 4096;
      const hopSize = 2048;

      const previousHpcpReferenceFrequency = extractor.profile.HPCP.referenceFrequency;

      extractor.profile.HPCP.referenceFrequency = tuningFrequency;

      const chords: Array<{
        beatIndex: number;
        timestampSeconds: number;
        chord: string;
        strength: number;
      }> = [];

      for (let beatIndex = 0; beatIndex < ticks.length - 1; beatIndex++) {
        const startSeconds = ticks[beatIndex];
        const endSeconds = ticks[beatIndex + 1];

        const startSample = Math.floor(startSeconds * sampleRate);

        const endSample = Math.min(Math.floor(endSeconds * sampleRate), samples.length);

        const hpcpFrames: Float32Array[] = [];

        for (let offset = startSample; offset + frameSize <= endSample; offset += hopSize) {
          const frame = samples.subarray(offset, offset + frameSize);

          const hpcp = extractor.hpcpExtractor(frame, sampleRate, false) as Float32Array;

          hpcpFrames.push(hpcp);
        }

        // Very short interval fallback:
        // use one frame centered inside the interval.
        if (!hpcpFrames.length) {
          const center = Math.floor(((startSeconds + endSeconds) / 2) * sampleRate);

          const frameStart = Math.max(0, Math.min(samples.length - frameSize, center - Math.floor(frameSize / 2)));

          const frame = samples.subarray(frameStart, frameStart + frameSize);

          hpcpFrames.push(extractor.hpcpExtractor(frame, sampleRate, false) as Float32Array);
        }

        // -----------------------------
        // Median HPCP across interval
        // -----------------------------
        const medianHpcp = new Float32Array(12);

        for (let bin = 0; bin < 12; bin++) {
          const values = hpcpFrames.map((frame) => frame[bin]).sort((a, b) => a - b);

          const middle = Math.floor(values.length / 2);

          medianHpcp[bin] = values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
        }

        // -----------------------------
        // Major/minor chord estimate
        // -----------------------------
        const hpcpVector = essentia.arrayToVector(medianHpcp);

        const chordResult = essentia.Key(hpcpVector, 4, 12, 'tonictriad', 0.6, false, false, false);

        hpcpVector.delete?.();

        const chord = chordResult.scale === 'minor' ? `${chordResult.key}m` : chordResult.key;

        chords.push({
          beatIndex,
          timestampSeconds: startSeconds,
          chord,
          strength: chordResult.strength
        });
      }

      const smoothedChords = smoothDetectedChords(chords);
      const mergedChords = mergeConsecutiveChords(smoothedChords);

      extractor.profile.HPCP.referenceFrequency = previousHpcpReferenceFrequency;

      const audioVector = essentia.arrayToVector(samples);

      const keyResult = essentia.KeyExtractor(
        audioVector,

        true, // averageDetuningCorrection
        4096, // frameSize
        4096, // hopSize
        12, // hpcpSize
        3500, // maxFrequency
        60, // maximumSpectralPeaks
        25, // minFrequency
        0.2, // pcpThreshold
        'bgate', // profileType
        44100, // sampleRate
        0.0001, // spectralPeaksThreshold

        tuningFrequency,

        'cosine', // weightType
        'hann' // windowType
      );

      audioVector.delete?.();

      const keyTonic = String(keyResult.key);

      const keyMode = keyResult.scale === 'minor' ? 'minor' : 'major';

      // -----------------------------
      // 4. Return everything together
      // -----------------------------
      postMessage({
        type: 'full-analysis-result',
        bpm: rhythmResult.bpm,
        ticks,
        chords: mergedChords,
        keyTonic,
        keyMode,
        loudnessLufs,
        loudnessStartSeconds: loudnessStartSample / loudnessSampleRate,
        loudnessEndSeconds: loudnessEndSample / loudnessSampleRate
      });

      console.log('Full-song key:', keyTonic, keyMode, '| tuning reference:', tuningFrequency);
    } catch (error) {
      postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (data?.type === 'analyze-tuning') {
    try {
      const samples = new Float32Array(data.samples);

      const sampleRate = 44100;
      const frameSize = 4096;
      const hopSize = 2048;

      const acceptedTunings: number[] = [];

      let totalFrames = 0;
      let rejectedLowEnergy = 0;
      let rejectedFewPeaks = 0;
      let rejectedInvalidTuning = 0;

      for (let offset = 0; offset + frameSize <= samples.length; offset += hopSize) {
        totalFrames++;

        const frame = samples.subarray(offset, offset + frameSize);

        // Simple RMS energy gate.
        let sumSquares = 0;

        for (let i = 0; i < frame.length; i++) {
          const sample = frame[i];
          sumSquares += sample * sample;
        }

        const rms = Math.sqrt(sumSquares / frame.length);

        // Ignore very weak/silent frames.
        if (rms < 0.01) {
          rejectedLowEnergy++;
          continue;
        }

        const frameVector = essentia.arrayToVector(frame);

        const windowed = essentia.Windowing(frameVector, false, frameSize, 'blackmanharris92', 0, true);

        frameVector.delete?.();

        const spectrum = essentia.Spectrum(windowed.frame, frameSize);

        windowed.frame.delete?.();

        const peaks = essentia.SpectralPeaks(
          spectrum.spectrum,
          0.0001, // magnitudeThreshold
          3500, // maxFrequency
          60, // maxPeaks
          40, // minFrequency
          'magnitude', // orderBy
          sampleRate
        );

        spectrum.spectrum.delete?.();

        const frequencies = essentia.vectorToArray(peaks.frequencies);

        const magnitudes = essentia.vectorToArray(peaks.magnitudes);

        if (frequencies.length < 5 || magnitudes.length < 5) {
          rejectedFewPeaks++;

          peaks.frequencies.delete?.();
          peaks.magnitudes.delete?.();

          continue;
        }

        const tuning = essentia.TuningFrequency(peaks.frequencies, peaks.magnitudes, 1);

        peaks.frequencies.delete?.();
        peaks.magnitudes.delete?.();

        const tuningFrequency = Number(tuning.tuningFrequency);

        if (!Number.isFinite(tuningFrequency) || tuningFrequency < 400 || tuningFrequency > 480) {
          rejectedInvalidTuning++;
          continue;
        }

        acceptedTunings.push(tuningFrequency);
      }

      if (!acceptedTunings.length) {
        throw new Error('No reliable tonal frames found for tuning detection.');
      }

      const centsValues = acceptedTunings.map((frequency) => 1200 * Math.log2(frequency / 440)).filter((cents) => Number.isFinite(cents) && cents >= -100 && cents <= 100);

      if (!centsValues.length) {
        throw new Error('No valid tuning-cent estimates found.');
      }

      const bucketSize = 2;
      const buckets = new Map<number, number>();

      for (const cents of centsValues) {
        const bucket = Math.round(cents / bucketSize) * bucketSize;

        buckets.set(bucket, (buckets.get(bucket) ?? 0) + 1);
      }

      let bestCenter = 0;
      let bestClusterCount = 0;

      for (const [bucket] of buckets) {
        const clusterCount = (buckets.get(bucket - bucketSize) ?? 0) + (buckets.get(bucket) ?? 0) + (buckets.get(bucket + bucketSize) ?? 0);

        if (clusterCount > bestClusterCount) {
          bestClusterCount = clusterCount;
          bestCenter = bucket;
        }
      }

      const clusterRadiusCents = 6;

      const clusteredValues = centsValues.filter((cents) => Math.abs(cents - bestCenter) <= clusterRadiusCents);

      if (!clusteredValues.length) {
        throw new Error('Unable to determine dominant tuning cluster.');
      }

      const tuningCents = clusteredValues.reduce((sum, value) => sum + value, 0) / clusteredValues.length;

      const tuningFrequency = 440 * Math.pow(2, tuningCents / 1200);

      const confidence = clusteredValues.length / centsValues.length;

      console.log('Tuning cluster stats:', {
        totalAcceptedFrames: centsValues.length,
        clusteredFrames: clusteredValues.length,
        bestCenter,
        tuningFrequency,
        tuningCents,
        confidence
      });

      postMessage({
        type: 'tuning-result',
        tuningFrequency,
        tuningCents,
        confidence
      });
    } catch (error) {
      postMessage({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }
});
