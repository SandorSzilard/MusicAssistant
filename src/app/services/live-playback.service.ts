import { Injectable, inject } from '@angular/core';
import { MidiEvent, PlaylistEntry, Song } from '../models/domain.models';
import { ApplicationStateService } from './application-state.service';
import { DspService } from './dsp.service';
import { LibraryService } from './library.service';
import { MidiDeviceService } from './midi-device.service';
import { MidiScheduleCursor, MidiSchedulerService } from './midi-scheduler.service';
import { LiveStateService } from './live-state.service';
import { PracticePlaybackService } from './practice-playback.service';

interface LivePreloadedSong {
  songId: string;
  durationSeconds: number | null;
}

@Injectable({ providedIn: 'root' })
export class LivePlaybackService {
  private readonly liveState = inject(LiveStateService);
  private readonly library = inject(LibraryService);
  private readonly dsp = inject(DspService);
  private readonly applicationState = inject(ApplicationStateService);
  private readonly midiDevices = inject(MidiDeviceService);
  private readonly midiScheduler = inject(MidiSchedulerService);
  private readonly practicePlayback = inject(PracticePlaybackService);

  readonly playlist = this.liveState.playlist;
  readonly liveCurrentIndex = this.liveState.liveCurrentIndex;
  readonly livePlaybackState = this.liveState.livePlaybackState;
  readonly liveCurrentTime = this.liveState.liveCurrentTime;
  readonly liveCountdownSeconds = this.liveState.liveCountdownSeconds;
  readonly liveActiveEntryId = this.liveState.liveActiveEntryId;
  readonly liveCurrentSong = this.liveState.currentSong;
  readonly liveCurrentEntry = this.liveState.currentEntry;
  readonly liveLoudnessTargetLufs = this.liveState.loudnessTargetLufs;
  readonly liveLoudnessMatchingEnabled = this.midiDevices.liveLoudnessMatchingEnabled;
  readonly activeMidiDevice = this.midiDevices.activeMidiDevice;
  readonly midiDeviceTimingCompensation = this.midiDevices.midiDeviceTimingCompensation;

  private liveSequenceToken = 0;
  private liveAnimationFrameId: number | null = null;
  private readonly liveMidiCursor: MidiScheduleCursor = this.midiScheduler.createCursor();
  private get status() { return this.applicationState.status; }

  // Shared playback policies
  private effectiveDspShift(song: Song): number { return this.practicePlayback.effectiveDspShift(song); }
  private effectiveBpm(song: Song): number | null { return this.practicePlayback.effectiveBpm(song); }
  private songStartSeconds(song: Song): number {
    const duration = song.durationSeconds ?? Number.POSITIVE_INFINITY;
    return Math.max(0, Math.min(song.startSeconds ?? 0, duration));
  }
  private songEndSeconds(song: Song): number {
    const startSeconds = this.songStartSeconds(song);
    const duration = song.durationSeconds ?? Number.POSITIVE_INFINITY;
    return Math.max(startSeconds, Math.min(song.endSeconds ?? duration, duration));
  }
  private effectivePauseEnabled(entry: PlaylistEntry): boolean {
    return this.playlist().pauseBetweenSongsEnabled && (entry.pauseAfterEnabled ?? true);
  }
  private effectivePauseSeconds(entry: PlaylistEntry): number {
    return entry.pauseAfterSeconds ?? this.playlist().pauseBetweenSongsSeconds;
  }
  private effectiveCountInEnabled(entry: PlaylistEntry, song: Song): boolean {
    return entry.countInEnabled ?? song.countInEnabled;
  }
  private effectiveCountInClicks(entry: PlaylistEntry, song: Song): number {
    return entry.countInClicks ?? song.countInClicks;
  }
  private liveLoudnessGainDb(song: Song): number | null { return this.liveState.loudnessGainDb(song); }
  private playCountInClick(accent = false): void { this.practicePlayback.playCountInClick(accent); }
  private async sendScheduledMidiEvent(event: MidiEvent): Promise<void> { await this.midiDevices.sendScheduledMidiEvent(event); }
  setLoudnessMatchingEnabled(enabled: boolean): void {
    this.midiDevices.setLiveLoudnessMatchingEnabled(enabled);
    const song = this.liveCurrentSong();
    if (song) {
      this.dsp.setOutputGainDb(enabled ? (this.liveLoudnessGainDb(song) ?? 0) : 0);
    }
  }
  private showMissingSongDialog(entry: PlaylistEntry): void {
    this.liveState.recoveryDialog.set({
      title: 'Audio file not found',
      message: `${entry.fileName ?? 'This song'} could not be found at its saved location.`,
      entry,
      kind: 'missing'
    });
  }
  private errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

  // Playback controls
  async startLivePlaylist(): Promise<void> {
    const playlist = this.playlist();

    if (!playlist.entries.length) {
      this.status.set('Live playlist is empty.');
      return;
    }

    this.stopLivePlayback();

    const token = ++this.liveSequenceToken;

    this.liveCurrentIndex.set(0);

    const song = this.liveCurrentSong();

    this.liveCurrentTime.set(song ? this.songStartSeconds(song) : 0);

    await this.playLiveEntry(0, token);
  }

  async startLivePlaylistFrom(index: number): Promise<void> {
    const entries = this.playlist().entries;

    if (index < 0 || index >= entries.length) {
      return;
    }

    this.stopLivePlayback();

    const token = ++this.liveSequenceToken;

    this.liveCurrentIndex.set(index);

    const song = this.liveCurrentSong();

    this.liveCurrentTime.set(song ? this.songStartSeconds(song) : 0);

    await this.playLiveEntry(index, token);
  }

  async toggleLivePlayback(): Promise<void> {
    const state = this.livePlaybackState();

    if (state === 'playing') {
      this.dsp.pause();
      this.stopLivePlaybackClock();
      this.livePlaybackState.set('paused');
      this.status.set('Live paused.');
      return;
    }

    if (state === 'paused') {
      const song = this.liveCurrentSong();
      const entry = this.liveCurrentEntry();

      if (!song || !entry) {
        return;
      }

      const durationSeconds = await this.ensureSongDuration(song);

      await this.dsp.play(this.liveCurrentTime(), 1, this.effectiveDspShift(song));

      this.livePlaybackState.set('playing');
      this.status.set(`Live: ${song.fileName}`);

      this.startLivePlaybackClock(song, entry, this.liveSequenceToken, durationSeconds);
      return;
    }

    if (state === 'ready') {
      await this.restartLiveCurrentSong();
      return;
    }

    if (state === 'finished' || state === 'error') {
      await this.startLivePlaylistFrom(this.liveCurrentIndex());
    }
  }

  async restartLiveCurrentSong(): Promise<void> {
    const song = this.liveCurrentSong();
    const entry = this.liveCurrentEntry();

    if (!song || !entry) {
      return;
    }

    const startSeconds = this.songStartSeconds(song);

    const token = ++this.liveSequenceToken;

    this.stopLivePlaybackClock();
    this.dsp.pause();

    this.liveCountdownSeconds.set(null);
    this.liveCurrentTime.set(startSeconds);

    const countInCompleted = await this.runLiveCountIn(song, entry, token);

    if (!countInCompleted || token !== this.liveSequenceToken) {
      return;
    }

    await this.dsp.play(startSeconds, 1, this.effectiveDspShift(song));

    if (token !== this.liveSequenceToken) {
      this.dsp.pause();
      return;
    }

    this.liveCurrentTime.set(startSeconds);
    this.livePlaybackState.set('playing');
    this.liveActiveEntryId.set(entry.id);

    this.status.set(`Live: ${song.fileName}`);

    this.startLivePlaybackClock(song, entry, token);
  }

  seekLiveByBeat(direction: -1 | 1): void {
    const song = this.liveCurrentSong();

    if (!song) {
      return;
    }

    const startSeconds = this.songStartSeconds(song);
    const endSeconds = this.songEndSeconds(song);

    const anchors =
      song.chords.length > 0
        ? song.chords
            .map((chord) => song.beats[chord.beatIndex]?.timestampSeconds)
            .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
            .filter((value) => value >= startSeconds && value <= endSeconds)
        : song.beats.map((beat) => beat.timestampSeconds).filter((value) => value >= startSeconds && value <= endSeconds);

    if (!anchors.length) {
      return;
    }

    const time = this.liveCurrentTime();

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

    const rawTargetTime = anchors[targetIndex];
    const targetTime = Math.max(startSeconds, Math.min(endSeconds, rawTargetTime));

    this.liveCurrentTime.set(targetTime);

    this.resetLiveMidiScheduler(song, targetTime);

    this.dsp.seek(targetTime, 1, this.effectiveDspShift(song));
  }

  // Entry loading and count-in
  private async playLiveEntry(index: number, token: number, preloaded: LivePreloadedSong | null = null): Promise<void> {
    if (token !== this.liveSequenceToken) {
      return;
    }

    const playlist = this.playlist();

    if (index < 0 || index >= playlist.entries.length) {
      this.finishLivePlaylist();
      return;
    }

    const entry = playlist.entries[index];
    const song = this.library.songs().find((item) => item.id === entry.songId);

    if (!song) {
      this.liveActiveEntryId.set(null);
      this.livePlaybackState.set('error');
      this.status.set(`Missing audio file: ${entry.fileName ?? entry.songId}`);
      this.showMissingSongDialog(entry);
      return;
    }

    this.liveActiveEntryId.set(entry.id);
    if (song.analysisState !== 'ready') {
      this.liveActiveEntryId.set(null);
      this.livePlaybackState.set('error');
      this.status.set(`${song.fileName} is not ready for Live playback.`);
      return;
    }

    if (!song.assetUrl) {
      this.livePlaybackState.set('error');
      this.status.set(`${song.fileName} has no audio source.`);
      return;
    }

    const startSeconds = this.songStartSeconds(song);

    this.liveCurrentIndex.set(index);
    this.liveCurrentTime.set(startSeconds);
    this.liveCountdownSeconds.set(null);
    this.livePlaybackState.set('loading');

    this.status.set(`Loading Live song: ${song.fileName}`);

    this.dsp.pause();

    try {
      let durationSeconds: number | null;

      if (preloaded?.songId === song.id) {
        durationSeconds = preloaded.durationSeconds;
      } else {
        durationSeconds = await this.ensureSongDuration(song);

        if (token !== this.liveSequenceToken) {
          return;
        }

        await this.dsp.loadAudio(song.assetUrl);

        if (token !== this.liveSequenceToken) {
          return;
        }
      }

      const calculatedGainDb = this.liveLoudnessGainDb(song);

      const loudnessGainDb = this.liveLoudnessMatchingEnabled() && calculatedGainDb != null ? calculatedGainDb : 0;

      this.dsp.setOutputGainDb(loudnessGainDb);

      console.log('Live loudness gain:', {
        song: song.fileName,
        loudnessLufs: song.loudnessLufs,
        targetLufs: this.liveLoudnessTargetLufs(),
        gainDb: loudnessGainDb
      });

      const countInCompleted = await this.runLiveCountIn(song, entry, token);

      if (!countInCompleted || token !== this.liveSequenceToken) {
        return;
      }

      await this.dsp.play(startSeconds, 1, this.effectiveDspShift(song));

      if (token !== this.liveSequenceToken) {
        this.dsp.pause();
        return;
      }

      this.liveCurrentTime.set(startSeconds);
      this.livePlaybackState.set('playing');

      this.status.set(`Live: ${song.fileName}`);

      this.startLivePlaybackClock(song, entry, token, durationSeconds);
    } catch (error) {
      this.livePlaybackState.set('error');
      this.status.set(`Live playback error: ${this.errorMessage(error)}`);
    }
  }

  private async runLiveCountIn(song: Song, entry: PlaylistEntry, token: number): Promise<boolean> {
    const enabled = this.effectiveCountInEnabled(entry, song);
    const clicks = this.effectiveCountInClicks(entry, song);

    if (!enabled || clicks <= 0) {
      return true;
    }

    const bpm = this.effectiveBpm(song);

    if (bpm == null || !Number.isFinite(bpm) || bpm <= 0) {
      this.livePlaybackState.set('error');
      this.status.set(`Cannot perform count-in for ${song.fileName}: BPM unavailable.`);
      return false;
    }

    const intervalMs = 60000 / bpm;

    this.livePlaybackState.set('counting-in');

    for (let i = 0; i < clicks; i++) {
      if (token !== this.liveSequenceToken) {
        return false;
      }

      this.status.set(`Live count-in ${i + 1} / ${clicks}`);
      this.playCountInClick(i === 0);

      await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
    }

    return token === this.liveSequenceToken;
  }

  // Playback clock and sequence progression
  private startLivePlaybackClock(song: Song, entry: PlaylistEntry, token: number, durationSeconds: number | null = song.durationSeconds ?? null): void {
    this.stopLivePlaybackClock();
    this.resetLiveMidiScheduler(song, this.dsp.currentTime());

    const startSeconds = this.songStartSeconds(song);
    const fallbackEndSeconds = durationSeconds ?? song.durationSeconds;
    const endSeconds = song.endSeconds != null ? this.songEndSeconds(song) : fallbackEndSeconds;

    const update = () => {
      if (token !== this.liveSequenceToken) {
        this.liveAnimationFrameId = null;
        return;
      }

      if (this.livePlaybackState() !== 'playing') {
        this.liveAnimationFrameId = null;
        return;
      }

      const rawTime = this.dsp.currentTime();

      this.processLiveMidiScheduler(song, rawTime);

      const time = typeof endSeconds === 'number' && Number.isFinite(endSeconds) ? Math.max(startSeconds, Math.min(endSeconds, rawTime)) : Math.max(startSeconds, rawTime);

      if (typeof endSeconds === 'number' && Number.isFinite(endSeconds) && time >= endSeconds - 0.15) {
        this.liveCurrentTime.set(endSeconds);
        this.liveAnimationFrameId = null;

        this.dsp.pause();

        void this.handleLiveSongEnded(entry, token);
        return;
      }

      this.liveCurrentTime.set(time);

      this.liveAnimationFrameId = requestAnimationFrame(update);
    };

    this.liveAnimationFrameId = requestAnimationFrame(update);
  }

  private stopLivePlaybackClock(): void {
    if (this.liveAnimationFrameId !== null) {
      cancelAnimationFrame(this.liveAnimationFrameId);

      this.liveAnimationFrameId = null;
    }
  }

  private async handleLiveSongEnded(entry: PlaylistEntry, token: number): Promise<void> {
    if (token !== this.liveSequenceToken) {
      return;
    }

    const nextIndex = this.liveCurrentIndex() + 1;
    const nextEntry = this.playlist().entries[nextIndex];

    if (!nextEntry) {
      this.finishLivePlaylist();
      return;
    }

    const nextSong = this.library.songs().find((song) => song.id === nextEntry.songId);

    if (!nextSong) {
      this.livePlaybackState.set('error');
      this.status.set('Next Live song is missing from the Library.');
      return;
    }

    /*
     * Start loading the next song immediately.
     * Do not await it yet — the pause countdown runs in parallel.
     */
    const preloadPromise = this.preloadLiveSong(nextSong, token);

    let pausePromise: Promise<boolean> = Promise.resolve(true);

    if (this.effectivePauseEnabled(entry)) {
      const seconds = this.effectivePauseSeconds(entry);

      if (seconds > 0) {
        pausePromise = this.runLiveInterSongPause(seconds, token);
      }
    }

    /*
     * Wait until BOTH are ready:
     * - pause countdown finished
     * - next audio finished loading
     */
    const [preloaded, pauseCompleted] = await Promise.all([preloadPromise, pausePromise]);

    if (token !== this.liveSequenceToken || !pauseCompleted) {
      return;
    }

    if (!preloaded) {
      this.livePlaybackState.set('error');
      this.status.set(`Could not load next Live song: ${nextSong.fileName}`);
      return;
    }

    await this.playLiveEntry(nextIndex, token, preloaded);
  }

  private async runLiveInterSongPause(seconds: number, token: number): Promise<boolean> {
    this.livePlaybackState.set('between-songs');

    const wholeSeconds = Math.max(0, Math.round(seconds));

    for (let remaining = wholeSeconds; remaining > 0; remaining--) {
      if (token !== this.liveSequenceToken) {
        return false;
      }

      this.liveCountdownSeconds.set(remaining);

      this.status.set(`Next song in ${remaining}s`);

      await new Promise<void>((resolve) => window.setTimeout(resolve, 1000));
    }

    this.liveCountdownSeconds.set(null);

    return token === this.liveSequenceToken;
  }

  // Stop and finish
  stopLivePlayback(): void {
    this.liveSequenceToken++;
    this.stopLivePlaybackClock();
    this.dsp.pause();
    const song = this.liveCurrentSong();

    this.liveCurrentTime.set(song ? this.songStartSeconds(song) : 0);
    this.liveCountdownSeconds.set(null);
    this.liveActiveEntryId.set(null);
    this.livePlaybackState.set('ready');
    this.status.set('Live playback stopped.');
  }

  private finishLivePlaylist(): void {
    this.stopLivePlaybackClock();
    this.dsp.pause();
    this.liveCountdownSeconds.set(null);
    this.liveActiveEntryId.set(null);
    this.livePlaybackState.set('finished');
    this.status.set('Live playlist finished.');
  }

  // Audio preparation and MIDI scheduling
  async ensureSongDuration(song: Song): Promise<number | null> {
    if (typeof song.durationSeconds === 'number' && Number.isFinite(song.durationSeconds) && song.durationSeconds > 0) {
      return song.durationSeconds;
    }

    if (!song.assetUrl) {
      return null;
    }

    return await new Promise<number | null>((resolve) => {
      const audio = new Audio();

      const cleanup = () => {
        audio.removeAttribute('src');
        audio.load();
      };

      audio.preload = 'metadata';

      audio.onloadedmetadata = () => {
        const duration = audio.duration;

        if (Number.isFinite(duration) && duration > 0) {
          this.library.update(song.id, {
            durationSeconds: duration
          });

          cleanup();
          resolve(duration);
          return;
        }

        cleanup();
        resolve(null);
      };

      audio.onerror = () => {
        cleanup();
        resolve(null);
      };

      audio.src = song.assetUrl!;
    });
  }

  private async preloadLiveSong(song: Song, token: number): Promise<LivePreloadedSong | null> {
    if (!song.assetUrl) {
      return null;
    }

    const durationSeconds = await this.ensureSongDuration(song);

    if (token !== this.liveSequenceToken) {
      return null;
    }

    await this.dsp.loadAudio(song.assetUrl);

    if (token !== this.liveSequenceToken) {
      return null;
    }

    return {
      songId: song.id,
      durationSeconds
    };
  }

  private resetLiveMidiScheduler(song: Song, timeSeconds: number): void {
    this.midiScheduler.reset(song, this.liveMidiCursor, timeSeconds, this.activeMidiDevice(), this.midiDeviceTimingCompensation());
  }

  private processLiveMidiScheduler(song: Song, timeSeconds: number): void {
    for (const event of this.midiScheduler.advance(song, this.liveMidiCursor, timeSeconds, this.activeMidiDevice(), this.midiDeviceTimingCompensation())) {
      const deviceName = event.deviceName || this.activeMidiDevice();
      const triggerTime = this.midiScheduler.triggerTime(song, event, this.activeMidiDevice(), this.midiDeviceTimingCompensation());

      console.log('Live MIDI event due:', {
        id: event.id,
        label: event.label,
        kind: event.kind,
        triggerTime,
        playbackTime: timeSeconds,
        deviceName
      });

      void this.sendScheduledMidiEvent(event);
    }
  }
}
