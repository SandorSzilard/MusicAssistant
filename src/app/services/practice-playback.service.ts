import { Injectable, inject, signal } from '@angular/core';
import { Song, SongSection } from '../models/domain.models';
import { formatTime } from '../utils/music.util';
import { ApplicationStateService } from './application-state.service';
import { DspService } from './dsp.service';
import { LibraryService } from './library.service';
import { MidiDeviceService } from './midi-device.service';
import { MidiScheduleCursor, MidiSchedulerService } from './midi-scheduler.service';
import { PracticeStateService } from './practice-state.service';

@Injectable({ providedIn: 'root' })
export class PracticePlaybackService {
  private readonly state = inject(PracticeStateService);
  private readonly library = inject(LibraryService);
  private readonly dsp = inject(DspService);
  private readonly applicationState = inject(ApplicationStateService);
  private readonly midiDevices = inject(MidiDeviceService);
  private readonly midiScheduler = inject(MidiSchedulerService);

  readonly dspAudioReady = signal(false);

  private animationFrameId: number | null = null;
  private countInCancelToken = 0;
  private readonly midiCursor: MidiScheduleCursor = this.midiScheduler.createCursor();
  private clickAudioContext: AudioContext | null = null;

  // Song selection and playback controls
  selectSong(song: Song): void {
    this.cancelCountIn();
    this.state.activeLoopSectionId.set(null);
    this.dsp.pause();
    this.state.isPlaying.set(false);
    this.stopPlaybackClock();
    this.state.currentTime.set(0);
    this.library.select(song.id);
    this.state.countInEnabled.set(song.countInEnabled);
    this.state.countInClicks.set(song.countInClicks);
    this.applicationState.tab.set('practice');
  }

  async loadDspAudio(song: Song): Promise<void> {
    if (!song.assetUrl) {
      return;
    }

    try {
      this.dspAudioReady.set(false);
      this.applicationState.status.set('Loading DSP audio...');
      await this.dsp.loadAudio(song.assetUrl);
      this.dsp.setOutputGainDb(0);
      this.dspAudioReady.set(true);
      this.applicationState.status.set('DSP audio ready.');
      console.log('Signalsmith audio loaded:', song.fileName);
    } catch (error) {
      this.dspAudioReady.set(false);
      console.error('Signalsmith load failed:', error);
      this.applicationState.status.set(`DSP load failed: ${this.errorMessage(error)}`);
    }
  }

  async togglePlay(): Promise<void> {
    const song = this.state.selectedSong();

    if (!song) {
      this.applicationState.status.set('No song selected.');
      return;
    }

    if (!this.dspAudioReady()) {
      this.applicationState.status.set('DSP audio is not ready yet.');
      return;
    }

    if (this.state.isCountingIn()) {
      this.cancelCountIn();
      return;
    }

    try {
      if (this.state.isPlaying()) {
        this.dsp.pause();
        this.state.isPlaying.set(false);
        this.applicationState.status.set('Paused');
        return;
      }

      const loopSection = this.state.activeLoopSection();
      const startSeconds = loopSection?.startSeconds ?? this.songStartSeconds(song);
      const endSeconds = loopSection?.endSeconds ?? this.songEndSeconds(song);
      let playFrom = this.state.currentTime();

      if (playFrom < startSeconds || playFrom >= endSeconds) {
        playFrom = startSeconds;
        this.state.currentTime.set(startSeconds);
      }

      const shouldCountIn = this.state.countInEnabled() || (!!loopSection && this.state.loopCountInEnabled());

      if (shouldCountIn) {
        const completed = await this.runCountIn(!!loopSection && !this.state.countInEnabled());

        if (!completed) {
          this.applicationState.status.set('Count-in cancelled');
          return;
        }
      }

      const effectiveShift = this.effectiveDspShift(song);
      await this.dsp.play(playFrom, this.state.practiceSpeed() / 100, effectiveShift);
      this.state.isPlaying.set(true);
      this.startPlaybackClock();
      this.applicationState.status.set(`Playing | pitch ${effectiveShift >= 0 ? '+' : ''}${effectiveShift.toFixed(3)} semitones`);
    } catch (error) {
      this.state.isPlaying.set(false);
      this.applicationState.status.set(`Playback error: ${this.errorMessage(error)}`);
    }
  }

  stopPlayback(): void {
    this.cancelCountIn();
    this.dsp.pause();
    this.state.isPlaying.set(false);
    const song = this.state.selectedSong();

    if (!song) {
      this.state.currentTime.set(0);
      this.applicationState.status.set('Stopped');
      return;
    }

    const startSeconds = this.songStartSeconds(song);
    this.state.currentTime.set(startSeconds);
    this.dsp.seek(startSeconds, this.state.practiceSpeed() / 100, this.effectiveDspShift(song));
    this.applicationState.status.set('Stopped');
  }

  async restartPlayback(): Promise<void> {
    const song = this.state.selectedSong();

    if (!song) {
      this.applicationState.status.set('No song selected.');
      return;
    }

    if (!this.dspAudioReady()) {
      this.applicationState.status.set('DSP audio is not ready yet.');
      return;
    }

    this.cancelCountIn();
    this.dsp.pause();
    this.state.isPlaying.set(false);
    const startSeconds = this.songStartSeconds(song);
    this.state.currentTime.set(startSeconds);

    try {
      if (this.state.countInEnabled()) {
        const completed = await this.runCountIn();

        if (!completed) {
          this.applicationState.status.set('Count-in cancelled');
          return;
        }
      }

      const effectiveShift = this.effectiveDspShift(song);
      await this.dsp.play(startSeconds, this.state.practiceSpeed() / 100, effectiveShift);
      this.state.currentTime.set(startSeconds);
      this.state.isPlaying.set(true);
      this.startPlaybackClock();
      this.applicationState.status.set(`Playing from ${formatTime(startSeconds)}`);
    } catch (error) {
      this.state.isPlaying.set(false);
      this.applicationState.status.set(`Playback error: ${this.errorMessage(error)}`);
    }
  }

  // Playback speed and loop positioning
  setSpeed(value: number): void {
    const next = Math.max(25, Math.min(150, value));
    this.state.practiceSpeed.set(next);
    const song = this.state.selectedSong();

    if (song) {
      this.dsp.setPitchAndRate(next / 100, this.effectiveDspShift(song));
    }
  }

  setFormantCompensation(enabled: boolean): void {
    this.state.formantCompensationEnabled.set(enabled);
    this.dsp.setFormantCompensation(enabled);
    this.applicationState.status.set(enabled ? 'Formant preservation enabled' : 'Formant preservation disabled');
  }

  effectiveBpm(song: Song): number | null {
    if (song.bpm == null || !Number.isFinite(song.bpm)) {
      return null;
    }

    return song.bpm * song.tempoMultiplier;
  }

  setLoopSection(sectionId: string | null): void {
    const song = this.state.selectedSong();

    if (!song) {
      return;
    }

    if (!sectionId) {
      this.state.activeLoopSectionId.set(null);
      this.applicationState.status.set('Section loop disabled.');
      return;
    }

    const section = song.sections.find((item) => item.id === sectionId);

    if (!section) {
      return;
    }

    this.state.activeLoopSectionId.set(section.id);
    this.state.currentTime.set(section.startSeconds);
    this.dsp.seek(section.startSeconds, this.state.practiceSpeed() / 100, this.effectiveDspShift(song));
    this.applicationState.status.set(`Loop section: ${section.label}`);
  }

  seekByBeat(direction: -1 | 1): void {
    const song = this.state.selectedSong();

    if (!song) {
      return;
    }

    const time = this.state.currentTime();
    const anchors =
      song.chords.length > 0
        ? song.chords.map((chord) => song.beats[chord.beatIndex]?.timestampSeconds).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        : song.beats.map((beat) => beat.timestampSeconds);

    if (!anchors.length) {
      return;
    }

    let currentIndex = 0;
    for (let i = 0; i < anchors.length; i++) {
      if (anchors[i] <= time + 0.01) {
        currentIndex = i;
      } else {
        break;
      }
    }

    let targetIndex = currentIndex;
    if (direction > 0) {
      if (currentIndex < anchors.length - 1) {
        targetIndex = currentIndex + 1;
      }
    } else {
      const restartThresholdSeconds = 0.7;
      const currentBlockStart = anchors[currentIndex];

      if (time - currentBlockStart > restartThresholdSeconds) {
        targetIndex = currentIndex;
      } else if (currentIndex > 0) {
        targetIndex = currentIndex - 1;
      }
    }

    const targetTime = anchors[targetIndex];
    this.state.currentTime.set(targetTime);
    this.dsp.seek(targetTime, this.state.practiceSpeed() / 100, this.effectiveDspShift(song));
  }

  // Playback lifecycle and count-in
  onAudioPlay(): void {
    this.state.isPlaying.set(true);
    this.startPlaybackClock();
  }

  onAudioPause(): void {
    this.state.isPlaying.set(false);
    this.stopPlaybackClock();
  }

  cancelCountIn(): void {
    this.countInCancelToken++;
    this.state.isCountingIn.set(false);
  }

  stopForAnalysis(): void {
    this.cancelCountIn();
    this.dsp.pause();
    this.state.isPlaying.set(false);
    this.state.currentTime.set(0);
    this.stopPlaybackClock();
  }

  stopPlaybackClock(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  // Pitch and MIDI scheduling
  effectiveDspShift(song: Song): number {
    return this.dsp.effectivePitchShiftSemitones(song.transposeSemitones, song.tuningCorrectionEnabled ? song.tuningCorrectionCents : 0);
  }

  private startPlaybackClock(): void {
    this.stopPlaybackClock();
    const startingSong = this.state.selectedSong();

    if (startingSong) {
      this.resetMidiScheduler(startingSong, this.dsp.currentTime());
    }

    const update = () => {
      if (!this.state.isPlaying()) {
        this.animationFrameId = null;
        return;
      }

      const song = this.state.selectedSong();

      if (!song) {
        this.animationFrameId = null;
        return;
      }

      const time = this.dsp.currentTime();
      this.processMidiScheduler(song, time);
      const loopSection = this.state.activeLoopSection();

      if (loopSection && time >= loopSection.endSeconds - 0.05) {
        this.animationFrameId = null;
        this.dsp.pause();
        this.state.isPlaying.set(false);
        this.state.currentTime.set(loopSection.startSeconds);
        void this.restartLoopSection(song, loopSection);
        return;
      }

      const endSeconds = this.songEndSeconds(song);

      if (time >= endSeconds) {
        this.dsp.pause();
        this.state.isPlaying.set(false);
        this.state.currentTime.set(endSeconds);
        this.animationFrameId = null;
        this.applicationState.status.set(`Reached end point at ${formatTime(endSeconds)}.`);
        return;
      }

      if (!this.state.isWaveformScrubbing()) {
        this.state.currentTime.set(time);
      }

      this.animationFrameId = requestAnimationFrame(update);
    };

    this.animationFrameId = requestAnimationFrame(update);
  }

  private async restartLoopSection(song: Song, section: SongSection): Promise<void> {
    const startSeconds = section.startSeconds;
    this.dsp.seek(startSeconds, this.state.practiceSpeed() / 100, this.effectiveDspShift(song));
    this.state.currentTime.set(startSeconds);

    if (this.state.loopCountInEnabled()) {
      const completed = await this.runCountIn(true);

      if (!completed) {
        this.applicationState.status.set('Loop count-in cancelled.');
        return;
      }
    }

    const activeSection = this.state.activeLoopSection();
    if (!activeSection || activeSection.id !== section.id) {
      return;
    }

    await this.dsp.play(startSeconds, this.state.practiceSpeed() / 100, this.effectiveDspShift(song));
    this.state.currentTime.set(startSeconds);
    this.state.isPlaying.set(true);
    this.startPlaybackClock();
    this.applicationState.status.set(`Looping section: ${section.label}`);
  }

  private resetMidiScheduler(song: Song, timeSeconds: number): void {
    this.midiScheduler.reset(song, this.midiCursor, timeSeconds, this.midiDevices.activeMidiDevice(), this.midiDevices.midiDeviceTimingCompensation());
  }

  private processMidiScheduler(song: Song, timeSeconds: number): void {
    for (const event of this.midiScheduler.advance(song, this.midiCursor, timeSeconds, this.midiDevices.activeMidiDevice(), this.midiDevices.midiDeviceTimingCompensation())) {
      const triggerTime = this.midiScheduler.triggerTime(song, event, this.midiDevices.activeMidiDevice(), this.midiDevices.midiDeviceTimingCompensation());
      const deviceName = event.deviceName || this.midiDevices.activeMidiDevice();
      const deviceTimingMs = this.midiDevices.midiDeviceTimingMs(deviceName);

      console.log('Practice MIDI event due:', {
        id: event.id,
        label: event.label,
        kind: event.kind,
        anchorBeatId: event.anchorBeatId,
        offsetMs: event.offsetMs,
        deviceTimingMs,
        triggerTime,
        playbackTime: timeSeconds,
        deviceName
      });

      void this.midiDevices.sendScheduledMidiEvent(event);

      if (triggerTime !== null) {
        this.applicationState.status.set(`MIDI due: ${event.label || event.kind} at ${formatTime(triggerTime)}`);
      }
    }
  }

  private async runCountIn(force = false): Promise<boolean> {
    const song = this.state.selectedSong();

    if (!song) {
      return false;
    }

    const clicks = this.state.countInClicks();

    if ((!this.state.countInEnabled() && !force) || clicks <= 0) {
      return true;
    }

    const bpm = this.effectiveBpm(song);

    if (song.analysisState !== 'ready' || typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) {
      this.state.countInEnabled.set(false);
      this.applicationState.status.set('Count-in requires analyzed BPM.');
      return false;
    }

    const intervalMs = 60000 / bpm;
    const token = ++this.countInCancelToken;
    this.state.isCountingIn.set(true);

    try {
      for (let i = 0; i < clicks; i++) {
        if (token !== this.countInCancelToken) {
          return false;
        }

        this.applicationState.status.set(`Count-in ${i + 1} / ${clicks}`);
        this.playCountInClick(i === 0);
        await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
      }

      return token === this.countInCancelToken;
    } finally {
      if (token === this.countInCancelToken) {
        this.state.isCountingIn.set(false);
      }
    }
  }

  playCountInClick(accent = false): void {
    if (!this.clickAudioContext) {
      this.clickAudioContext = new AudioContext();
    }

    const context = this.clickAudioContext;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = 'square';
    oscillator.frequency.value = accent ? 1400 : 1000;
    gain.gain.setValueAtTime(0.18, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.05);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.05);
  }

  private songStartSeconds(song: Song): number {
    const duration = song.durationSeconds ?? Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(song.startSeconds ?? 0, duration));
  }

  private songEndSeconds(song: Song): number {
    const startSeconds = this.songStartSeconds(song);
    const duration = song.durationSeconds ?? Number.POSITIVE_INFINITY;
    const endSeconds = song.endSeconds ?? duration;
    return Math.max(startSeconds, Math.min(endSeconds, duration));
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }
}
