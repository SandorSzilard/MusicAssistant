import { Injectable } from '@angular/core';

export interface AnalysisAudioBuffers {
  mono: Float32Array<ArrayBuffer>;
  left: Float32Array<ArrayBuffer>;
  right: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

export interface AnalysisDetectedChord {
  beatIndex: number;
  timestampSeconds: number;
  chord: string;
  strength: number;
  spanBeats?: number;
}

export type AnalysisWorkerRequest =
  | { type: 'ping' }
  | { type: 'analyze-rhythm'; samples: ArrayBuffer }
  | { type: 'analyze-chords-beats'; samples: ArrayBuffer; ticks: number[] }
  | { type: 'analyze-regional-rhythm'; samples: ArrayBuffer; startSeconds: number; endSeconds: number }
  | {
      type: 'analyze-regional-chords';
      samples: ArrayBuffer;
      ticks: number[];
      beatIndexes: number[];
      startSeconds: number;
      endSeconds: number;
      tuningFrequency: number;
    }
  | { type: 'analyze-loudness'; left: ArrayBuffer; right: ArrayBuffer; startSeconds: number; endSeconds: number }
  | {
      type: 'full-analysis';
      samples: ArrayBuffer;
      left: ArrayBuffer;
      right: ArrayBuffer;
      tuningFrequency: number;
      loudnessStartSeconds: number;
      loudnessEndSeconds: number;
    }
  | { type: 'analyze-tuning'; samples: ArrayBuffer };

export type AnalysisWorkerResponse =
  | { type: 'ready'; hasRhythmExtractor2013: boolean }
  | { type: 'rhythm-result'; bpm: number; ticks: number[] }
  | { type: 'chords-beats-result'; chords: AnalysisDetectedChord[] }
  | { type: 'regional-rhythm-result'; bpm: number; ticks: number[] }
  | { type: 'regional-chords-result'; chords: AnalysisDetectedChord[] }
  | { type: 'loudness-result'; loudnessLufs: number; startSeconds: number; endSeconds: number }
  | {
      type: 'full-analysis-result';
      bpm: number;
      ticks: number[];
      chords: AnalysisDetectedChord[];
      keyTonic: string | null;
      keyMode: 'major' | 'minor' | null;
      loudnessLufs: number;
      loudnessStartSeconds: number;
      loudnessEndSeconds: number;
    }
  | { type: 'tuning-result'; tuningFrequency: number; tuningCents: number; confidence: number }
  | { type: 'error'; message: string };

export class AnalysisWorkerSession {
  private readonly worker: Worker;

  onmessage: ((data: AnalysisWorkerResponse) => void) | null = null;
  onerror: ((error: ErrorEvent) => void) | null = null;

  constructor() {
    this.worker = new Worker(new URL('../workers/essentia.worker', import.meta.url), { type: 'module' });
    this.worker.onmessage = ({ data }) => this.onmessage?.(data);
    this.worker.onerror = (error) => this.onerror?.(error);
  }

  postMessage(message: AnalysisWorkerRequest, transfer: Transferable[] = []): void {
    this.worker.postMessage(message, transfer);
  }

  terminate(): void {
    this.worker.terminate();
  }
}

@Injectable({ providedIn: 'root' })
export class AnalysisService {
  createWorker(): AnalysisWorkerSession {
    return new AnalysisWorkerSession();
  }

  async decodeAudio(assetUrl: string): Promise<AnalysisAudioBuffers> {
    const response = await fetch(assetUrl);
    const arrayBuffer = await response.arrayBuffer();
    const audioContext = new AudioContext({ sampleRate: 44100 });

    try {
      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
      const left = new Float32Array(audioBuffer.getChannelData(0));
      const right = audioBuffer.numberOfChannels > 1 ? new Float32Array(audioBuffer.getChannelData(1)) : new Float32Array(audioBuffer.getChannelData(0));
      const mono = new Float32Array(audioBuffer.length);

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);

        for (let i = 0; i < channelData.length; i++) {
          mono[i] += channelData[i] / audioBuffer.numberOfChannels;
        }
      }

      return {
        mono,
        left,
        right,
        sampleRate: audioBuffer.sampleRate
      };
    } finally {
      await audioContext.close();
    }
  }

  createWaveformPeaks(samples: Float32Array<ArrayBufferLike>, bucketCount = 600): number[] {
    if (!samples.length || bucketCount <= 0) {
      return [];
    }

    const actualBucketCount = Math.min(bucketCount, samples.length);
    const samplesPerBucket = samples.length / actualBucketCount;
    const levels = new Array<number>(actualBucketCount);
    let strongestLevel = 0;

    for (let bucket = 0; bucket < actualBucketCount; bucket++) {
      const start = Math.floor(bucket * samplesPerBucket);
      const end = Math.min(samples.length, Math.floor((bucket + 1) * samplesPerBucket));
      let sumSquares = 0;
      let sampleCount = 0;

      for (let i = start; i < end; i++) {
        const sample = samples[i];

        sumSquares += sample * sample;
        sampleCount++;
      }

      const rms = sampleCount > 0 ? Math.sqrt(sumSquares / sampleCount) : 0;

      levels[bucket] = rms;
      strongestLevel = Math.max(strongestLevel, rms);
    }

    if (strongestLevel <= 0) {
      return levels.map(() => 0);
    }

    return levels.map((level) => level / strongestLevel);
  }
}
