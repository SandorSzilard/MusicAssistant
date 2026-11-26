import { Injectable } from '@angular/core';
import SignalsmithStretch from 'signalsmith-stretch';

type SignalsmithNode = AudioNode & {
  inputTime: number;

  addBuffers(buffers: Float32Array[]): Promise<number>;

  dropBuffers(): Promise<unknown> | void;

  setUpdateInterval(seconds: number, callback?: () => void): void;

  schedule(options: {
    output?: number;
    active?: boolean;
    input?: number;
    rate?: number;
    semitones?: number;
    tonalityHz?: number;
    formantSemitones?: number;
    formantCompensation?: boolean;
    formantBaseHz?: number;
  }): void;

  start(when?: number): void;
  stop(when?: number): void;
};

@Injectable({
  providedIn: 'root'
})
export class DspService {
  readonly engine = 'signalsmith-stretch';

  private audioContext: AudioContext | null = null;
  private stretch: SignalsmithNode | null = null;
  private outputGain: GainNode | null = null;

  private formantCompensationEnabled = false;

  centsToSemitones(cents: number): number {
    return cents / 100;
  }

  effectivePitchShiftSemitones(transposeSemitones: number, tuningCorrectionCents: number): number {
    return transposeSemitones + this.centsToSemitones(tuningCorrectionCents);
  }

  async loadAudio(assetUrl: string): Promise<number> {
    await this.dispose();

    const response = await fetch(assetUrl);
    const arrayBuffer = await response.arrayBuffer();

    this.audioContext = new AudioContext();

    const decoded = await this.audioContext.decodeAudioData(arrayBuffer.slice(0));

    const stretch = (await SignalsmithStretch(this.audioContext)) as SignalsmithNode;

    stretch.setUpdateInterval(1 / 60);

    const outputGain = this.audioContext.createGain();
    outputGain.gain.value = 1;

    stretch.connect(outputGain);
    outputGain.connect(this.audioContext.destination);

    this.outputGain = outputGain;

    const channels: Float32Array[] = [];

    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      channels.push(new Float32Array(decoded.getChannelData(channel)));
    }

    await stretch.addBuffers(channels);

    this.stretch = stretch;

    return decoded.duration;
  }

  async play(inputSeconds: number, rate: number, semitones: number): Promise<void> {
    if (!this.audioContext || !this.stretch) {
      throw new Error('DSP audio has not been loaded.');
    }

    if (this.audioContext.state === 'suspended') {
      await this.audioContext.resume();
    }

    this.stretch.schedule({
      input: Math.max(0, inputSeconds),
      rate,
      semitones,
      formantCompensation: this.formantCompensationEnabled,
      formantBaseHz: 0,
      active: true
    });
  }

  pause(): void {
    this.stretch?.schedule({
      active: false
    });
  }

  seek(inputSeconds: number, rate: number, semitones: number): void {
    this.stretch?.schedule({
      input: Math.max(0, inputSeconds),
      rate,
      semitones,
      formantCompensation: this.formantCompensationEnabled,
      formantBaseHz: 0
    });
  }

  setPitchAndRate(rate: number, semitones: number): void {
    this.stretch?.schedule({
      rate,
      semitones,
      formantCompensation: this.formantCompensationEnabled,
      formantBaseHz: 0
    });
  }

  setOutputGainDb(gainDb: number): void {
    const safeGainDb = Number.isFinite(gainDb) ? Math.min(0, gainDb) : 0;

    const linearGain = Math.pow(10, safeGainDb / 20);

    if (this.outputGain) {
      this.outputGain.gain.value = linearGain;
    }
  }

  setFormantCompensation(enabled: boolean): void {
    this.formantCompensationEnabled = enabled;

    this.stretch?.schedule({
      formantCompensation: enabled,
      formantBaseHz: 0
    });
  }

  currentTime(): number {
    return this.stretch?.inputTime ?? 0;
  }

  async dispose(): Promise<void> {
    if (this.stretch) {
      try {
        this.stretch.stop();
      } catch {
        // Nothing to do.
      }

      try {
        await this.stretch.dropBuffers();
      } catch {
        // Nothing to do.
      }

      this.stretch.disconnect();
      this.stretch = null;
    }

    if (this.outputGain) {
      try {
        this.outputGain.disconnect();
      } catch {
        // Nothing to do.
      }

      this.outputGain = null;
    }

    if (this.audioContext) {
      try {
        await this.audioContext.close();
      } catch {
        // Nothing to do.
      }

      this.audioContext = null;
    }
  }
}
