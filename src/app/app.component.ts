import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDragDrop, DragDropModule, moveItemInArray } from '@angular/cdk/drag-drop';
import { BackendService, HealthInfo } from './services/backend.service';
import { LibraryService } from './services/library.service';
import { SidecarService } from './services/sidecar.service';
import { ChordEvent, MidiEvent, MidiMessageKind, Song, SongSection, Playlist, PlaylistEntry } from './models/domain.models';
import { clampTranspose, formatTime, inverseTransposeChord, transposeChord, displaySongKey } from './utils/music.util';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { DspService } from './services/dsp.service';
import { MusicAssistantFileService } from './services/music-assistant-file.service';
import { SettingsService } from './services/settings.service';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

type Tab = 'library' | 'practice' | 'live' | 'midi' | 'settings';

type LivePlaybackState = 'ready' | 'loading' | 'counting-in' | 'playing' | 'paused' | 'between-songs' | 'finished' | 'error';

interface LivePreloadedSong {
  songId: string;
  durationSeconds: number | null;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements OnInit {
  @ViewChild('audio') audioRef?: ElementRef<HTMLAudioElement>;
  @ViewChild('livePlaylist') livePlaylistRef?: ElementRef<HTMLDivElement>;

  readonly Math = Math;
  readonly sectionColors = ['#e05252', '#e28a3b', '#d9b83e', '#62b85c', '#39a8a1', '#4f8cff', '#796bd8', '#b85fb4'];

  readonly backend = inject(BackendService);
  readonly library = inject(LibraryService);
  private readonly sidecars = inject(SidecarService);
  private readonly dsp = inject(DspService);
  private readonly musicAssistantFiles = inject(MusicAssistantFileService);
  private readonly settings = inject(SettingsService);

  readonly tab = signal<Tab>('library');
  readonly status = signal('Ready');
  readonly health = signal<HealthInfo | null>(null);
  readonly audioOutputs = signal<string[]>([]);
  readonly midiOutputs = signal<string[]>([]);
  readonly activeMidiDevice = signal('');
  readonly countInClicks = signal(4);
  readonly countInEnabled = signal(false);
  readonly countInEditing = signal(false);
  readonly countInEditValue = signal('3');
  readonly practiceSpeed = signal(100);
  readonly formantCompensationEnabled = signal(false);
  readonly currentTime = signal(0);
  readonly isPlaying = signal(false);
  readonly selectedSong = this.library.selectedSong;
  readonly displayedChords = computed(() => {
    const song = this.selectedSong();
    return song?.chords.map((c) => ({ ...c, displayed: transposeChord(c.canonicalChord, song.transposeSemitones) })) ?? [];
  });
  readonly currentChordIndex = computed(() => {
    const song = this.selectedSong();

    if (!song || !song.chords.length || !song.beats.length) {
      return -1;
    }

    const time = this.chordDisplayTime(song, this.currentTime());

    let activeIndex = -1;

    for (let i = 0; i < song.chords.length; i++) {
      const chord = song.chords[i];
      const beat = song.beats.find((b) => b.id === chord.beatId);

      if (!beat) continue;

      if (beat.timestampSeconds <= time) {
        activeIndex = i;
      } else {
        break;
      }
    }

    return activeIndex;
  });
  readonly currentChord = computed(() => {
    const song = this.selectedSong();

    if (!song?.chords.length || !song.beats.length) {
      return null;
    }

    const time = this.currentTime();

    for (let i = song.chords.length - 1; i >= 0; i--) {
      const chord = song.chords[i];
      const startBeat = song.beats[chord.beatIndex];

      if (!startBeat) continue;

      if (startBeat.timestampSeconds <= time + 0.01) {
        return {
          ...chord,
          displayed: transposeChord(chord.canonicalChord, song.transposeSemitones)
        };
      }
    }

    const first = song.chords[0];

    return first
      ? {
          ...first,
          displayed: transposeChord(first.canonicalChord, song.transposeSemitones)
        }
      : null;
  });
  readonly nextChord = computed(() => {
    const song = this.selectedSong();
    const current = this.currentChord();

    if (!song || !current) {
      return null;
    }

    const currentIndex = song.chords.findIndex((chord) => chord.id === current.id);

    if (currentIndex < 0 || currentIndex >= song.chords.length - 1) {
      return null;
    }

    const next = song.chords[currentIndex + 1];

    return {
      ...next,
      displayed: transposeChord(next.canonicalChord, song.transposeSemitones)
    };
  });
  readonly selectedChordId = signal<string | null>(null);
  readonly chordEditValue = signal('');
  readonly chordEditInvalid = signal(false);
  readonly chordContextMenu = signal<{
    x: number;
    top: number | null;
    bottom: number | null;
    chordId: string;
  } | null>(null);
  readonly isWaveformScrubbing = signal(false);
  readonly waveformContextMenu = signal<{
    x: number;
    y: number;
    timeSeconds: number;
    sectionId: string | null;
  } | null>(null);
  readonly waveformMenuPage = signal<'main' | 'boundaries'>('main');
  readonly sectionCreateDialog = signal<{
    startSeconds: number;
  } | null>(null);
  readonly sectionEditDialog = signal<{
    sectionId: string;
  } | null>(null);

  readonly sectionNameInput = signal('');
  readonly sectionColorInput = signal('#4f8cff');
  readonly pendingSection = signal<{
    startSeconds: number;
    label: string;
    color: string;
  } | null>(null);
  readonly isCountingIn = signal(false);
  readonly canUseCountIn = computed(() => {
    const song = this.selectedSong();

    return !!song && song.analysisState === 'ready' && typeof song.bpm === 'number' && Number.isFinite(song.bpm) && song.bpm > 0;
  });
  readonly isAnalyzing = signal(false);
  readonly isLibraryDragOver = signal(false);
  sourceTuningInput = signal<number | null>(null);
  readonly dspAudioReady = signal(false);
  readonly tuningChoicePrompt = signal<{
    songId: string;
    fileName: string;
    detectedHz: number;
    tuningCents: number;
  } | null>(null);
  readonly playlist = signal<Playlist>({
    schemaVersion: 1,
    id: 'default-playlist',
    name: 'Live Set',

    pauseBetweenSongsEnabled: false,
    pauseBetweenSongsSeconds: 5,

    entries: []
  });
  readonly liveCurrentIndex = signal(0);
  readonly livePlaybackState = signal<LivePlaybackState>('ready');
  readonly liveCurrentTime = signal(0);
  readonly liveCountdownSeconds = signal<number | null>(null);
  readonly liveActiveEntryId = signal<string | null>(null);
  readonly recoveryDialog = signal<{
    title: string;
    message: string;
    entry: PlaylistEntry | null;
    kind: 'missing' | 'invalid' | 'info';
  } | null>(null);
  readonly activeLoopSectionId = signal<string | null>(null);
  readonly activeLoopSection = computed(() => {
    const song = this.selectedSong();
    const sectionId = this.activeLoopSectionId();

    if (!song || !sectionId) {
      return null;
    }

    return song.sections.find((section) => section.id === sectionId) ?? null;
  });
  readonly loopCountInEnabled = signal(false);
  readonly midiEventDialog = signal<{
    chordId: string;
    eventId: string | null;
  } | null>(null);
  readonly midiEventKindInput = signal<MidiMessageKind>('program-change');
  readonly midiEventChannelInput = signal(1);
  readonly midiEventData1Input = signal(0);
  readonly midiEventData2Input = signal(127);
  readonly midiEventRawBytesInput = signal<number[]>([]);
  readonly midiEventOffsetInput = signal(0);
  readonly midiEventLabelInput = signal('');
  readonly midiEventDeviceInput = signal('');
  readonly midiDeviceTimingCompensation = signal<Record<string, number>>({});
  readonly midiInputs = signal<string[]>([]);
  readonly activeMidiInputDevice = signal('');
  readonly midiInputListening = signal(false);
  readonly lastMidiInputMessage = signal<{
    timestamp: number;
    bytes: number[];
  } | null>(null);
  readonly midiInputMessages = signal<
    Array<{
      receivedAt: number;
      timestamp: number;
      bytes: number[];
    }>
  >([]);
  readonly midiPasteInput = signal('');
  readonly midiPasteError = signal('');
  readonly liveLoudnessMatchingEnabled = signal(true);
  readonly shortcutHelpOpen = signal(false);

  private midiInputUnlisten: UnlistenFn | null = null;

  private liveSequenceToken = 0;

  private liveAnimationFrameId: number | null = null;
  private liveMidiFiredEventIds = new Set<string>();
  private liveMidiLastTime = 0;

  readonly chordWidthPx = 90;
  readonly chordDisplayLeadBeats = 0;
  private animationFrameId: number | null = null;
  private chordClickTimer: number | null = null;
  private countInCancelToken = 0;
  private practiceMidiFiredEventIds = new Set<string>();
  private practiceMidiLastTime = 0;
  private clickAudioContext: AudioContext | null = null;
  private analysisQueue: Song[] = [];
  private currentAnalysisSongId: string | null = null;
  private readonly loudnessAnalysisGenerations = new Map<string, number>();

  private pendingTuningAnalysis: {
    songId: string;
    worker: Worker;
    mono: Float32Array;
    left: Float32Array;
    right: Float32Array;
  } | null = null;

  midiKind: MidiMessageKind = 'program-change';
  midiChannel = 1;
  midiData1 = 0;
  midiData2 = 127;
  midiOffsetMs = -100;

  async ngOnInit(): Promise<void> {
    this.health.set(await this.backend.health());

    const settings = await this.settings.load();

    this.activeMidiDevice.set(settings.midi.outputDevice);
    this.activeMidiInputDevice.set(settings.midi.inputDevice);
    this.midiDeviceTimingCompensation.set({
      ...settings.midi.deviceTimingCompensationMs
    });
    this.liveLoudnessMatchingEnabled.set(settings.live.loudnessMatchingEnabled);

    await this.refreshDevices();

    void this.setupFileDrop();
  }

  private async setupFileDrop(): Promise<void> {
    if (!this.backend.nativeAvailable) return;

    await getCurrentWebview().onDragDropEvent((event) => {
      if (this.tab() !== 'library') {
        this.isLibraryDragOver.set(false);
        return;
      }

      if (event.payload.type === 'enter' || event.payload.type === 'over') {
        this.isLibraryDragOver.set(true);
        return;
      }

      if (event.payload.type === 'leave') {
        this.isLibraryDragOver.set(false);
        return;
      }

      if (event.payload.type === 'drop') {
        this.isLibraryDragOver.set(false);

        const validPaths = event.payload.paths.filter((path) => /\.(mp3|wav|musicassistant)$/i.test(path));

        if (!validPaths.length) {
          return;
        }

        for (const path of validPaths) {
          if (/\.musicassistant$/i.test(path)) {
            void this.openLivePlaylistFromPath(path);
          } else {
            void this.importSongFromPath(path);
          }
        }
      }
    });
  }

  async refreshDevices(): Promise<void> {
    try {
      this.audioOutputs.set(await this.backend.listAudioOutputs());

      const previousInputDevice = this.activeMidiInputDevice();
      const previousOutputDevice = this.activeMidiDevice();

      const midiInputs = await this.backend.listMidiInputs();
      this.midiInputs.set(midiInputs);

      const inputDisconnected = !!previousInputDevice && !midiInputs.includes(previousInputDevice);

      if (inputDisconnected) {
        this.activeMidiInputDevice.set('');
      }

      const midiOutputs = await this.backend.listMidiOutputs();
      this.midiOutputs.set(midiOutputs);

      const outputDisconnected = !!previousOutputDevice && !midiOutputs.includes(previousOutputDevice);

      if (outputDisconnected) {
        this.activeMidiDevice.set('');
      }

      if (inputDisconnected || outputDisconnected) {
        const disconnectedDevices: string[] = [];

        if (outputDisconnected) {
          disconnectedDevices.push(`MIDI output "${previousOutputDevice}"`);
        }

        if (inputDisconnected) {
          disconnectedDevices.push(`MIDI input "${previousInputDevice}"`);
        }

        this.status.set(`${disconnectedDevices.join(' and ')} disconnected. Device selection was cleared.`);

        void this.saveGlobalSettings();
      }
    } catch (error) {
      this.status.set(this.errorMessage(error));
    }
  }

  async importSong(): Promise<void> {
    try {
      const path = await this.backend.chooseImportFile();

      if (!path) {
        return;
      }

      if (/\.musicassistant$/i.test(path)) {
        await this.openLivePlaylistFromPath(path);
        return;
      }

      await this.importSongFromPath(path);
      this.tab.set('practice');
    } catch (error) {
      this.status.set(this.errorMessage(error));
    }
  }

  async importSongFromPath(path: string): Promise<Song | null> {
    this.countInEnabled.set(false);

    try {
      this.status.set('Hashing audio file...');

      const hash = await this.backend.hashFile(path);
      const fileName = path.split(/[\\/]/).pop() ?? path;

      const song: Song = {
        id: hash.slice(0, 16),
        sourcePath: path,
        fileName,
        assetUrl: this.backend.assetUrl(path),
        fingerprintSha256: hash,
        transposeSemitones: 0,
        countInEnabled: false,
        countInClicks: 4,
        analysisState: 'not-analyzed',
        beats: [],
        chords: [],
        waveformPeaks: [],
        midiEvents: [],
        sections: [],
        tuningCents: 0,
        tuningCorrectionEnabled: false,
        detectedTuningHz: null,
        sourceTuningHz: null,
        tuningCorrectionCents: 0,
        keyTonic: null,
        keyMode: null,
        tempoMultiplier: 1
      };

      const sidecar = await this.sidecars.load(song);

      if (sidecar) {
        song.bpm = sidecar.analysis.bpm;
        song.loudnessLufs = sidecar.analysis.loudnessLufs;
        song.beats = sidecar.analysis.beats ?? [];
        song.chords = sidecar.analysis.chords ?? [];
        song.waveformPeaks = sidecar.analysis.waveformPeaks ?? [];
        song.transposeSemitones = sidecar.userEdits.transposeSemitones ?? 0;
        song.startSeconds = sidecar.userEdits.startSeconds;
        song.endSeconds = sidecar.userEdits.endSeconds;
        song.countInEnabled = sidecar.userEdits.countInEnabled ?? false;
        song.countInClicks = sidecar.userEdits.countInClicks ?? 4;
        song.midiEvents = sidecar.userEdits.midiEvents ?? [];
        song.sections = sidecar.userEdits.sections ?? [];
        song.detectedTuningHz = sidecar.analysis.detectedTuningHz ?? null;
        song.tuningCents = sidecar.analysis.tuningCents ?? 0;
        song.sourceTuningHz = sidecar.userEdits.sourceTuningHz ?? song.detectedTuningHz;
        song.tuningCorrectionEnabled = sidecar.userEdits.tuningCorrectionEnabled ?? false;
        song.tuningCorrectionCents = sidecar.userEdits.tuningCorrectionCents ?? 0;
        song.keyTonic = sidecar.analysis.keyTonic ?? null;
        song.keyMode = sidecar.analysis.keyMode ?? null;
        song.tempoMultiplier = sidecar.userEdits.tempoMultiplier ?? 1;

        if (song.beats.length > 0 && song.chords.length > 0) {
          song.analysisState = 'ready';
        }
      }

      this.library.add(song);

      this.activeLoopSectionId.set(null);

      this.sourceTuningInput.set(Math.round(song.sourceTuningHz ?? 440));

      this.countInEnabled.set(song.countInEnabled);
      this.countInClicks.set(song.countInClicks);

      setTimeout(() => {
        this.loadAudio();

        void this.loadDspAudio(song);

        if (song.analysisState === 'ready') {
          this.status.set('Loaded analysis from sidecar.');
        } else {
          this.status.set('Imported. Starting analysis...');
          this.enqueueAnalysis(song);
        }
      }, 0);
      return song;
    } catch (error) {
      this.status.set(this.errorMessage(error));
      return null;
    }
  }

  loadAudio(): void {
    const audio = this.audioRef?.nativeElement;

    const song = this.selectedSong();

    if (audio && song?.assetUrl) {
      audio.pause();

      audio.src = song.assetUrl;

      audio.currentTime = 0;

      audio.load();
    }
  }

  private effectiveDspShift(song: Song): number {
    return this.dsp.effectivePitchShiftSemitones(song.transposeSemitones, song.tuningCorrectionEnabled ? song.tuningCorrectionCents : 0);
  }

  private async loadDspAudio(song: Song): Promise<void> {
    if (!song.assetUrl) return;

    try {
      this.dspAudioReady.set(false);

      this.status.set('Loading DSP audio...');

      await this.dsp.loadAudio(song.assetUrl);

      this.dsp.setOutputGainDb(0);

      this.dspAudioReady.set(true);

      this.status.set('DSP audio ready.');

      console.log('Signalsmith audio loaded:', song.fileName);
    } catch (error) {
      this.dspAudioReady.set(false);

      console.error('Signalsmith load failed:', error);

      this.status.set(`DSP load failed: ${this.errorMessage(error)}`);
    }
  }

  selectSong(song: Song): void {
    // Stop anything left from the previous Practice session.
    this.cancelCountIn();
    this.activeLoopSectionId.set(null);

    this.dsp.pause();

    this.isPlaying.set(false);

    this.stopPlaybackClock();

    // Practice always opens at the beginning.
    this.currentTime.set(0);

    // Select the requested song.
    this.library.select(song.id);

    // Restore that song's saved count-in settings.
    this.countInEnabled.set(song.countInEnabled);

    this.countInClicks.set(song.countInClicks);

    this.tab.set('practice');

    setTimeout(() => {
      this.loadAudio();

      void this.loadDspAudio(song);
    }, 0);
  }

  onAudioTime(): void {
    const audio = this.audioRef?.nativeElement;
    if (audio) this.currentTime.set(audio.currentTime);
  }

  onMetadata(): void {
    const audio = this.audioRef?.nativeElement;
    const song = this.selectedSong();
    if (audio && song && Number.isFinite(audio.duration)) this.library.update(song.id, { durationSeconds: audio.duration });
  }

  async togglePlay(): Promise<void> {
    const song = this.selectedSong();

    if (!song) {
      this.status.set('No song selected.');
      return;
    }

    if (!this.dspAudioReady()) {
      this.status.set('DSP audio is not ready yet.');
      return;
    }

    if (this.isCountingIn()) {
      this.cancelCountIn();
      return;
    }

    try {
      if (this.isPlaying()) {
        this.dsp.pause();
        this.isPlaying.set(false);
        this.status.set('Paused');
        return;
      }

      const loopSection = this.activeLoopSection();

      const startSeconds = loopSection?.startSeconds ?? this.songStartSeconds(song);
      const endSeconds = loopSection?.endSeconds ?? this.songEndSeconds(song);

      let playFrom = this.currentTime();

      if (playFrom < startSeconds || playFrom >= endSeconds) {
        playFrom = startSeconds;
        this.currentTime.set(startSeconds);
      }

      const shouldCountIn = this.countInEnabled() || (loopSection && this.loopCountInEnabled());

      if (shouldCountIn) {
        const completed = await this.runCountIn(!!loopSection && !this.countInEnabled());

        if (!completed) {
          this.status.set('Count-in cancelled');
          return;
        }
      }

      const effectiveShift = this.effectiveDspShift(song);

      await this.dsp.play(playFrom, this.practiceSpeed() / 100, effectiveShift);

      this.isPlaying.set(true);
      this.startPlaybackClock();

      this.status.set(`Playing | pitch ${effectiveShift >= 0 ? '+' : ''}${effectiveShift.toFixed(3)} semitones`);
    } catch (error) {
      this.isPlaying.set(false);
      this.status.set(`Playback error: ${this.errorMessage(error)}`);
    }
  }

  stopPlayback(): void {
    this.cancelCountIn();

    this.dsp.pause();
    this.isPlaying.set(false);

    const song = this.selectedSong();

    if (!song) {
      this.currentTime.set(0);
      this.status.set('Stopped');
      return;
    }

    const startSeconds = this.songStartSeconds(song);

    this.currentTime.set(startSeconds);

    this.dsp.seek(startSeconds, this.practiceSpeed() / 100, this.effectiveDspShift(song));

    this.status.set('Stopped');
  }

  async restartPlayback(): Promise<void> {
    const song = this.selectedSong();

    if (!song) {
      this.status.set('No song selected.');
      return;
    }

    if (!this.dspAudioReady()) {
      this.status.set('DSP audio is not ready yet.');
      return;
    }

    this.cancelCountIn();

    this.dsp.pause();
    this.isPlaying.set(false);

    const startSeconds = this.songStartSeconds(song);

    this.currentTime.set(startSeconds);

    try {
      if (this.countInEnabled()) {
        const completed = await this.runCountIn();

        if (!completed) {
          this.status.set('Count-in cancelled');
          return;
        }
      }

      const effectiveShift = this.effectiveDspShift(song);

      await this.dsp.play(startSeconds, this.practiceSpeed() / 100, effectiveShift);

      this.currentTime.set(startSeconds);
      this.isPlaying.set(true);

      this.startPlaybackClock();

      this.status.set(`Playing from ${this.formatTime(startSeconds)}`);
    } catch (error) {
      this.isPlaying.set(false);
      this.status.set(`Playback error: ${this.errorMessage(error)}`);
    }
  }

  @HostListener('window:keydown', ['$event'])
  onGlobalKeydown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;

    const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.tagName === 'SELECT' || target?.isContentEditable;

    if (typing) return;

    if (event.key === '?') {
      event.preventDefault();

      if (!event.repeat) {
        this.shortcutHelpOpen.set(!this.shortcutHelpOpen());
      }

      return;
    }

    if (event.key === 'Escape' && this.shortcutHelpOpen()) {
      event.preventDefault();
      this.closeShortcutHelp();
      return;
    }

    if (this.shortcutHelpOpen()) {
      return;
    }

    if (this.tab() === 'live') {
      this.handleLiveKeydown(event);
      return;
    }

    if (this.tab() !== 'practice') {
      return;
    }

    if (event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();

      if (!event.repeat) {
        void this.togglePlay();
        this.blurActiveElement();
      }

      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.seekByBeat(-1);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.seekByBeat(1);
      return;
    }

    if (event.repeat) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.stopPlayback();
      this.blurActiveElement();
      return;
    }

    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      void this.restartPlayback();
      this.blurActiveElement();
      return;
    }

    if (event.key.toLowerCase() === 'c') {
      event.preventDefault();

      if (this.canUseCountIn()) {
        this.countInEnabled.set(!this.countInEnabled());

        this.status.set(this.countInEnabled() ? `Count-in enabled: ${this.countInClicks()} clicks` : 'Count-in disabled');
      }

      this.blurActiveElement();
      return;
    }

    if (event.key === '[') {
      event.preventDefault();
      this.setSpeed(this.practiceSpeed() - 5);
      this.blurActiveElement();
      return;
    }

    if (event.key === ']') {
      event.preventDefault();
      this.setSpeed(this.practiceSpeed() + 5);
      this.blurActiveElement();
    }
  }

  @HostListener('document:click')
  closeOpenTransientUi(): void {
    this.closeChordContextMenu();
    this.closeWaveformContextMenu();
  }

  private handleLiveKeydown(event: KeyboardEvent): void {
    if (event.code === 'Space') {
      event.preventDefault();
      event.stopPropagation();

      if (!event.repeat) {
        void this.toggleLivePlayback();
        this.blurActiveElement();
      }

      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.seekLiveByBeat(-1);
      return;
    }

    if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.seekLiveByBeat(1);
      return;
    }

    if (event.repeat) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      this.stopLivePlayback();
      this.blurActiveElement();
      return;
    }

    if (event.key.toLowerCase() === 'r') {
      event.preventDefault();
      void this.restartLiveCurrentSong();
      this.blurActiveElement();
    }
  }

  private blurActiveElement(): void {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
  }

  onAudioPlay(): void {
    this.isPlaying.set(true);
    this.startPlaybackClock();
  }

  onAudioPause(): void {
    this.isPlaying.set(false);
    this.stopPlaybackClock();
  }

  private resetPracticeMidiScheduler(song: Song, timeSeconds: number): void {
    this.practiceMidiFiredEventIds.clear();
    this.practiceMidiLastTime = timeSeconds;

    for (const event of song.midiEvents) {
      const beat = song.beats.find((item) => item.id === event.anchorBeatId);

      if (!beat) {
        continue;
      }

      const deviceName = event.deviceName || this.activeMidiDevice();
      const deviceTimingMs = this.midiDeviceTimingMs(deviceName);

      const triggerTime = beat.timestampSeconds + (event.offsetMs + deviceTimingMs) / 1000;

      if (triggerTime < timeSeconds - 0.02) {
        this.practiceMidiFiredEventIds.add(event.id);
      }
    }
  }

  private processPracticeMidiScheduler(song: Song, timeSeconds: number): void {
    const previousTime = this.practiceMidiLastTime;

    if (timeSeconds < previousTime - 0.1) {
      this.resetPracticeMidiScheduler(song, timeSeconds);
      return;
    }

    for (const event of song.midiEvents) {
      if (this.practiceMidiFiredEventIds.has(event.id)) {
        continue;
      }

      const beat = song.beats.find((item) => item.id === event.anchorBeatId);

      if (!beat) {
        continue;
      }

      const deviceName = event.deviceName || this.activeMidiDevice();
      const deviceTimingMs = this.midiDeviceTimingMs(deviceName);

      const triggerTime = beat.timestampSeconds + (event.offsetMs + deviceTimingMs) / 1000;

      if (timeSeconds >= triggerTime) {
        this.practiceMidiFiredEventIds.add(event.id);

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

        void this.sendScheduledMidiEvent(event);

        this.status.set(`MIDI due: ${event.label || event.kind} at ${this.formatTime(triggerTime)}`);
      }
    }

    this.practiceMidiLastTime = timeSeconds;
  }

  private startPlaybackClock(): void {
    this.stopPlaybackClock();

    const startingSong = this.selectedSong();

    if (startingSong) {
      this.resetPracticeMidiScheduler(startingSong, this.dsp.currentTime());
    }

    const update = () => {
      if (!this.isPlaying()) {
        this.animationFrameId = null;
        return;
      }

      const song = this.selectedSong();

      if (!song) {
        this.animationFrameId = null;
        return;
      }

      const time = this.dsp.currentTime();

      this.processPracticeMidiScheduler(song, time);

      const loopSection = this.activeLoopSection();

      if (loopSection && time >= loopSection.endSeconds - 0.05) {
        this.animationFrameId = null;

        this.dsp.pause();
        this.isPlaying.set(false);
        this.currentTime.set(loopSection.startSeconds);

        void this.restartLoopSection(song, loopSection);

        return;
      }

      const endSeconds = this.songEndSeconds(song);

      if (time >= endSeconds) {
        this.dsp.pause();

        this.isPlaying.set(false);
        this.currentTime.set(endSeconds);
        this.animationFrameId = null;

        this.status.set(`Reached end point at ${this.formatTime(endSeconds)}.`);
        return;
      }

      if (!this.isWaveformScrubbing()) {
        this.currentTime.set(time);
      }

      this.animationFrameId = requestAnimationFrame(update);
    };

    this.animationFrameId = requestAnimationFrame(update);
  }

  private async restartLoopSection(song: Song, section: SongSection): Promise<void> {
    const startSeconds = section.startSeconds;

    this.dsp.seek(startSeconds, this.practiceSpeed() / 100, this.effectiveDspShift(song));
    this.currentTime.set(startSeconds);

    if (this.loopCountInEnabled()) {
      const completed = await this.runCountIn(true);

      if (!completed) {
        this.status.set('Loop count-in cancelled.');
        return;
      }
    }

    const activeSection = this.activeLoopSection();

    if (!activeSection || activeSection.id !== section.id) {
      return;
    }

    await this.dsp.play(startSeconds, this.practiceSpeed() / 100, this.effectiveDspShift(song));

    this.currentTime.set(startSeconds);
    this.isPlaying.set(true);

    this.startPlaybackClock();

    this.status.set(`Looping section: ${section.label}`);
  }

  private stopPlaybackClock(): void {
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);

      this.animationFrameId = null;
    }
  }

  setSpeed(value: number): void {
    const next = Math.max(25, Math.min(150, value));

    this.practiceSpeed.set(next);

    const song = this.selectedSong();

    if (!song) return;

    this.dsp.setPitchAndRate(next / 100, this.effectiveDspShift(song));
  }

  setTranspose(value: number): void {
    const song = this.selectedSong();
    if (!song) return;

    const transposeSemitones = clampTranspose(value);

    this.library.update(song.id, {
      transposeSemitones
    });

    const effectiveShift = this.dsp.effectivePitchShiftSemitones(transposeSemitones, song.tuningCorrectionEnabled ? song.tuningCorrectionCents : 0);

    this.dsp.setPitchAndRate(this.practiceSpeed() / 100, effectiveShift);

    console.log('DSP pitch shift:', {
      transposeSemitones,
      tuningCorrectionCents: song.tuningCorrectionEnabled ? song.tuningCorrectionCents : 0,
      effectiveShiftSemitones: effectiveShift
    });

    const updatedSong = this.selectedSong();

    if (updatedSong) {
      void this.sidecars.save(updatedSong).catch((error) => {
        console.error('Automatic sidecar save failed:', error);
      });
    }
  }

  effectiveBpm(song: Song): number | null {
    if (song.bpm == null || !Number.isFinite(song.bpm)) {
      return null;
    }

    return song.bpm * song.tempoMultiplier;
  }

  setTempoMultiplier(multiplier: 0.5 | 1 | 2): void {
    const song = this.selectedSong();

    if (!song || song.bpm == null) {
      return;
    }

    this.library.update(song.id, {
      tempoMultiplier: multiplier
    });

    const updatedSong = this.selectedSong();

    if (updatedSong) {
      void this.sidecars.save(updatedSong).catch((error) => {
        console.error('Automatic sidecar save failed:', error);
      });
    }
  }

  onFormantCompensationToggle(event: Event): void {
    const input = event.target as HTMLInputElement;

    const enabled = input.checked;

    this.formantCompensationEnabled.set(enabled);

    this.dsp.setFormantCompensation(enabled);

    this.status.set(enabled ? 'Formant preservation enabled' : 'Formant preservation disabled');

    input.blur();
  }

  addDemoAnalysis(): void {
    const song = this.selectedSong();
    if (!song) return;
    const names = ['C', 'Am', 'F', 'G', 'C', 'Am', 'F', 'G'];
    const beats = Array.from({ length: names.length }, (_, i) => ({ id: `beat-${i}`, index: i, timestampSeconds: i * 2 }));
    const chords: ChordEvent[] = names.map((name, i) => ({ id: `chord-${i}`, beatId: beats[i].id, beatIndex: i, canonicalChord: name }));
    this.library.update(song.id, { bpm: 120, tuningCents: 0, beats, chords, analysisState: 'ready' });
    this.status.set('Demo analysis added. Replace this with Essentia.js worker output in Milestone 2.');
  }

  seekToChord(chord: ChordEvent): void {
    if (this.chordClickTimer !== null) {
      window.clearTimeout(this.chordClickTimer);
    }

    this.chordClickTimer = window.setTimeout(() => {
      const song = this.selectedSong();

      if (!song) return;

      const beat = song.beats.find((b) => b.id === chord.beatId);

      if (!beat) return;

      this.currentTime.set(beat.timestampSeconds);

      this.dsp.seek(beat.timestampSeconds, this.practiceSpeed() / 100, this.effectiveDspShift(song));

      this.status.set(`Seeked to ${chord.canonicalChord} at ${this.formatTime(beat.timestampSeconds)}`);

      this.chordClickTimer = null;
    }, 180);
  }

  openChordContextMenu(event: MouseEvent, chord: ChordEvent): void {
    event.preventDefault();
    event.stopPropagation();

    if (this.chordClickTimer !== null) {
      window.clearTimeout(this.chordClickTimer);
      this.chordClickTimer = null;
    }

    const menuWidth = 220;
    const viewportPadding = 8;

    const x = Math.max(viewportPadding, Math.min(event.clientX, window.innerWidth - menuWidth - viewportPadding));

    const openUpward = event.clientY > window.innerHeight / 2;

    const top = openUpward ? null : Math.max(viewportPadding, event.clientY);

    const bottom = openUpward ? Math.max(viewportPadding, window.innerHeight - event.clientY) : null;

    this.chordContextMenu.set({
      x,
      top,
      bottom,
      chordId: chord.id
    });
  }

  closeChordContextMenu(): void {
    this.chordContextMenu.set(null);
  }

  editChordFromContextMenu(): void {
    const menu = this.chordContextMenu();

    if (!menu) {
      return;
    }

    const song = this.selectedSong();
    const chord = song?.chords.find((item) => item.id === menu.chordId);

    this.closeChordContextMenu();

    if (!chord) {
      return;
    }

    this.selectChordForEdit(chord);
  }

  addMidiEventFromContextMenu(): void {
    const menu = this.chordContextMenu();
    const song = this.selectedSong();

    if (!menu || !song) {
      return;
    }

    const chord = song.chords.find((item) => item.id === menu.chordId);

    if (!chord) {
      return;
    }

    this.midiEventKindInput.set('program-change');
    this.midiEventChannelInput.set(1);
    this.midiEventData1Input.set(0);
    this.midiEventData2Input.set(127);
    this.midiEventRawBytesInput.set([]);
    this.midiEventOffsetInput.set(0);
    this.midiEventLabelInput.set('');
    this.midiEventDeviceInput.set('');
    this.midiPasteInput.set('');
    this.midiPasteError.set('');

    this.midiEventDialog.set({
      chordId: chord.id,
      eventId: null
    });

    this.closeChordContextMenu();
  }

  editMidiEventFromContextMenu(eventId: string): void {
    const song = this.selectedSong();
    const midiEvent = song?.midiEvents.find((event) => event.id === eventId);

    if (!song || !midiEvent) {
      return;
    }

    this.midiEventKindInput.set(midiEvent.kind);
    this.midiEventChannelInput.set(midiEvent.channel);
    this.midiEventData1Input.set(midiEvent.data1);
    this.midiEventData2Input.set(midiEvent.data2 ?? 0);
    this.midiEventRawBytesInput.set(midiEvent.rawBytes ? [...midiEvent.rawBytes] : []);
    this.midiEventOffsetInput.set(midiEvent.offsetMs);
    this.midiEventLabelInput.set(midiEvent.label ?? '');
    this.midiEventDeviceInput.set(midiEvent.deviceName ?? '');
    this.midiPasteInput.set('');
    this.midiPasteError.set('');

    this.midiEventDialog.set({
      chordId: midiEvent.anchorChordId ?? '',
      eventId: midiEvent.id
    });

    this.closeChordContextMenu();
  }

  editMidiEventFromMarker(event: MouseEvent, chordId: string): void {
    event.preventDefault();
    event.stopPropagation();

    const midiEvents = this.midiEventsForChord(chordId);

    if (midiEvents.length === 1) {
      this.editMidiEventFromContextMenu(midiEvents[0].id);
      return;
    }

    if (midiEvents.length > 1) {
      this.status.set('This chord has multiple MIDI events. Right-click the chord to choose one.');
    }
  }

  cancelMidiEventDialog(): void {
    this.midiEventDialog.set(null);
  }

  closeMidiDialogFromBackdrop(event: PointerEvent): void {
    if (event.target !== event.currentTarget) {
      return;
    }

    this.cancelMidiEventDialog();
  }

  saveMidiEventDialog(): void {
    const dialog = this.midiEventDialog();
    const song = this.selectedSong();

    if (!dialog || !song) {
      return;
    }

    const chord = song.chords.find((item) => item.id === dialog.chordId);

    if (!chord) {
      this.status.set('Could not find the chord for this MIDI event.');
      return;
    }

    const beat = song.beats[chord.beatIndex];

    if (!beat) {
      this.status.set('Could not find the beat for this MIDI event.');
      return;
    }

    const channel = Math.max(1, Math.min(16, Math.round(this.midiEventChannelInput())));
    const data1 = Math.max(0, Math.min(127, Math.round(this.midiEventData1Input())));
    const data2 = Math.max(0, Math.min(127, Math.round(this.midiEventData2Input())));
    const offsetMs = Math.round(this.midiEventOffsetInput());
    const existingEvent = dialog.eventId ? song.midiEvents.find((event) => event.id === dialog.eventId) : null;

    const midiEvent: MidiEvent = {
      id: existingEvent?.id ?? `midi-${Date.now()}`,
      anchorBeatId: beat.id,
      anchorChordId: chord.id,
      offsetMs,
      deviceName: this.midiEventDeviceInput().trim() || undefined,
      kind: this.midiEventKindInput(),
      channel,
      data1,
      data2: this.midiEventKindInput() === 'control-change' ? data2 : undefined,
      rawBytes: this.midiEventKindInput() === 'raw' ? [...this.midiEventRawBytesInput()] : undefined,
      label: this.midiEventLabelInput().trim() || undefined
    };

    const midiEvents = existingEvent ? song.midiEvents.map((event) => (event.id === existingEvent.id ? midiEvent : event)) : [...song.midiEvents, midiEvent];

    const updatedSong: Song = {
      ...song,
      midiEvents
    };

    this.library.update(song.id, {
      midiEvents
    });

    void this.sidecars.save(updatedSong).catch((error) => {
      console.error('Automatic sidecar save failed:', error);
      this.status.set(`MIDI event added, but sidecar save failed: ${this.errorMessage(error)}`);
    });

    this.midiEventDialog.set(null);

    this.status.set(existingEvent ? `MIDI event updated: ${midiEvent.label || midiEvent.kind}` : `MIDI event added at beat ${beat.index + 1}: ${midiEvent.label || midiEvent.kind}`);
  }

  deleteMidiEvent(eventId: string): void {
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    const midiEvent = song.midiEvents.find((event) => event.id === eventId);

    if (!midiEvent) {
      return;
    }

    const midiEvents = song.midiEvents.filter((event) => event.id !== eventId);

    const updatedSong: Song = {
      ...song,
      midiEvents
    };

    this.library.update(song.id, {
      midiEvents
    });

    void this.sidecars.save(updatedSong).catch((error) => {
      console.error('Automatic sidecar save failed:', error);
      this.status.set(`MIDI event deleted, but sidecar save failed: ${this.errorMessage(error)}`);
    });

    this.closeChordContextMenu();

    this.status.set(`Deleted MIDI event: ${midiEvent.label || midiEvent.kind}`);
  }

  setChordToNoChord(): void {
    const menu = this.chordContextMenu();

    if (!menu) {
      return;
    }

    const song = this.selectedSong();
    const chord = song?.chords.find((item) => item.id === menu.chordId);

    this.closeChordContextMenu();

    if (!song || !chord) {
      return;
    }

    this.applyChordEdit(chord, 'N.C.');
  }

  editChordOnDoubleClick(chord: ChordEvent): void {
    if (this.chordClickTimer !== null) {
      window.clearTimeout(this.chordClickTimer);
      this.chordClickTimer = null;
    }

    this.selectChordForEdit(chord);
  }

  selectChordForEdit(chord: ChordEvent): void {
    const song = this.selectedSong();
    if (!song) return;

    this.selectedChordId.set(chord.id);
    this.chordEditValue.set(transposeChord(chord.canonicalChord, song.transposeSemitones));
    this.chordEditInvalid.set(false);
  }

  private applyChordEdit(chord: ChordEvent, displayedChord: string): void {
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    const entered = displayedChord.trim();

    if (!this.isValidChordName(entered)) {
      this.chordEditInvalid.set(true);
      this.status.set(`Invalid chord: ${entered}`);
      return;
    }

    const canonical = entered === 'N.C.' ? 'N.C.' : inverseTransposeChord(entered, song.transposeSemitones);

    const chords = song.chords.map((item) =>
      item.id === chord.id
        ? {
            ...item,
            canonicalChord: canonical,
            userEdited: true
          }
        : item
    );

    const updatedSong: Song = {
      ...song,
      chords
    };

    this.library.update(song.id, { chords });

    void this.sidecars.save(updatedSong).catch((error) => {
      console.error(`Automatic sidecar save failed for ${song.fileName}:`, error);
      this.status.set(`Chord changed, but sidecar save failed: ${this.errorMessage(error)}`);
    });

    this.status.set(`Chord changed to ${entered}.`);
  }

  saveChordEdit(chord: ChordEvent): void {
    const entered = this.chordEditValue().trim();

    if (!entered) {
      this.cancelChordEdit();
      return;
    }

    if (!this.isValidChordName(entered)) {
      this.chordEditInvalid.set(true);
      this.status.set(`Invalid chord: ${entered}`);
      return;
    }

    this.chordEditInvalid.set(false);

    this.applyChordEdit(chord, entered);

    this.selectedChordId.set(null);
    this.chordEditValue.set('');
  }

  cancelChordEdit(): void {
    this.selectedChordId.set(null);
    this.chordEditValue.set('');
    this.chordEditInvalid.set(false);
  }

  selectInputText(event: FocusEvent): void {
    const input = event.target as HTMLInputElement | null;
    input?.select();
  }

  private isValidChordName(value: string): boolean {
    const chord = value.trim();

    if (chord === 'N.C.') return true;

    const chordPattern = /^(C|C#|D|D#|Eb|E|F|F#|G|G#|A|Bb|B)(m|maj|min|dim|aug|sus2|sus4|add9|m7|maj7|7|m9|maj9|9|6|m6)?(\/(C|C#|D|D#|Eb|E|F|F#|G|G#|A|Bb|B))?$/;

    return chordPattern.test(chord);
  }

  chordTimelineTransform(): string {
    const song = this.selectedSong();

    if (!song?.beats.length) {
      return 'translateX(0px)';
    }

    const time = this.chordDisplayTime(song, this.currentTime());

    const beats = song.beats;

    let currentBeatIndex = 0;

    for (let i = 0; i < beats.length; i++) {
      if (beats[i].timestampSeconds <= time) {
        currentBeatIndex = i;
      } else {
        break;
      }
    }

    const currentBeat = beats[currentBeatIndex];
    const nextBeat = beats[currentBeatIndex + 1];

    let fractionalBeatIndex = currentBeatIndex;

    if (currentBeat && nextBeat) {
      const span = nextBeat.timestampSeconds - currentBeat.timestampSeconds;

      if (span > 0) {
        const progress = Math.max(0, Math.min(1, (time - currentBeat.timestampSeconds) / span));

        fractionalBeatIndex += progress;
      }
    }

    const offsetPx = fractionalBeatIndex * this.chordWidthPx;

    return `translateX(-${offsetPx}px)`;
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

  private clampPracticeTime(song: Song, timeSeconds: number): number {
    return Math.max(this.songStartSeconds(song), Math.min(this.songEndSeconds(song), timeSeconds));
  }

  private saveSongBoundaries(song: Song, startSeconds: number | undefined, endSeconds: number | undefined): void {
    this.library.update(song.id, {
      startSeconds,
      endSeconds
    });

    const updatedSong = this.library.songs().find((item) => item.id === song.id);

    if (!updatedSong) {
      return;
    }

    void this.sidecars.save(updatedSong).catch((error) => {
      console.error('Automatic sidecar save failed:', error);

      this.status.set(`Boundary changed, but sidecar save failed: ${this.errorMessage(error)}`);
    });

    void this.recalculateSongLoudness(updatedSong);
  }

  onTimelineScrub(event: Event): void {
    const input = event.target as HTMLInputElement;
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    const rawTime = Number(input.value);

    if (!Number.isFinite(rawTime)) {
      return;
    }

    this.currentTime.set(this.clampPracticeTime(song, rawTime));
  }

  onTimelineScrubEnd(event: Event): void {
    const input = event.target as HTMLInputElement;
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    const rawTime = Number(input.value);

    if (!Number.isFinite(rawTime)) {
      return;
    }

    const time = this.clampPracticeTime(song, rawTime);

    this.currentTime.set(time);

    this.dsp.seek(time, this.practiceSpeed() / 100, this.effectiveDspShift(song));

    input.blur();
  }

  openWaveformContextMenu(event: MouseEvent): void {
    event.preventDefault();
    event.stopPropagation();

    const song = this.selectedSong();

    if (!song?.durationSeconds) {
      return;
    }

    const waveform = event.currentTarget as HTMLElement;
    const rect = waveform.getBoundingClientRect();

    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const ratio = x / rect.width;
    const timeSeconds = ratio * song.durationSeconds;

    const sectionAtTime = song.sections.find((section) => timeSeconds >= section.startSeconds && timeSeconds <= section.endSeconds) ?? null;

    const menuWidth = 190;
    const menuHeight = 230;
    const viewportPadding = 8;

    const menuX = Math.max(viewportPadding, Math.min(event.clientX, window.innerWidth - menuWidth - viewportPadding));
    const menuY = Math.max(viewportPadding, Math.min(event.clientY, window.innerHeight - menuHeight - viewportPadding));

    this.waveformMenuPage.set('main');

    this.waveformContextMenu.set({
      x: menuX,
      y: menuY,
      timeSeconds,
      sectionId: sectionAtTime?.id ?? null
    });
  }

  closeWaveformContextMenu(): void {
    this.waveformContextMenu.set(null);
    this.waveformMenuPage.set('main');
  }

  startSectionCreation(): void {
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    const menu = this.waveformContextMenu();

    if (!menu) {
      return;
    }

    this.sectionNameInput.set('');
    this.sectionColorInput.set('#4f8cff');

    this.sectionCreateDialog.set({
      startSeconds: this.clampPracticeTime(song, this.currentTime())
    });

    this.closeWaveformContextMenu();
  }

  cancelSectionCreation(): void {
    this.sectionCreateDialog.set(null);
    this.sectionNameInput.set('');
  }

  confirmSectionCreation(): void {
    const dialog = this.sectionCreateDialog();
    const label = this.sectionNameInput().trim();
    const color = this.sectionColorInput();

    if (!dialog) {
      return;
    }

    if (!label) {
      this.status.set('Section name cannot be empty.');
      return;
    }

    this.pendingSection.set({
      startSeconds: dialog.startSeconds,
      label,
      color
    });

    this.sectionCreateDialog.set(null);

    this.status.set(`Section "${label}" started at ${this.formatTime(dialog.startSeconds)}. Right-click later to set its end.`);
  }

  finishPendingSection(): void {
    const menu = this.waveformContextMenu();
    const pending = this.pendingSection();
    const song = this.selectedSong();

    if (!menu || !pending || !song) {
      return;
    }

    const endSeconds = this.clampPracticeTime(song, this.currentTime());

    if (endSeconds <= pending.startSeconds + 0.05) {
      this.status.set(`Section "${pending.label}" must end after its start.`);
      return;
    }

    const section: SongSection = {
      id: `section-${Date.now()}`,
      label: pending.label,
      color: pending.color,
      startSeconds: pending.startSeconds,
      endSeconds
    };

    const sections = [...song.sections, section].sort((a, b) => a.startSeconds - b.startSeconds);

    this.library.update(song.id, {
      sections
    });

    const updatedSong = this.selectedSong();

    if (updatedSong) {
      void this.sidecars.save(updatedSong).catch((error) => {
        console.error('Automatic sidecar save failed:', error);
        this.status.set(`Section created, but sidecar save failed: ${this.errorMessage(error)}`);
      });
    }

    this.pendingSection.set(null);
    this.closeWaveformContextMenu();

    this.status.set(`Section "${section.label}" saved: ${this.formatTime(section.startSeconds)} – ${this.formatTime(section.endSeconds)}.`);
  }

  cancelPendingSection(): void {
    const pending = this.pendingSection();

    this.pendingSection.set(null);
    this.closeWaveformContextMenu();

    if (pending) {
      this.status.set(`Cancelled section "${pending.label}".`);
    }
  }

  deleteSectionFromContextMenu(): void {
    const menu = this.waveformContextMenu();
    const song = this.selectedSong();

    if (!menu?.sectionId || !song) {
      return;
    }

    const section = song.sections.find((item) => item.id === menu.sectionId);

    if (!section) {
      return;
    }

    const sections = song.sections.filter((item) => item.id !== section.id);

    this.library.update(song.id, {
      sections
    });

    if (this.activeLoopSectionId() === section.id) {
      this.activeLoopSectionId.set(null);
    }

    const updatedSong = this.selectedSong();

    if (updatedSong) {
      void this.sidecars.save(updatedSong).catch((error) => {
        console.error('Automatic sidecar save failed:', error);
        this.status.set(`Section deleted, but sidecar save failed: ${this.errorMessage(error)}`);
      });
    }

    this.closeWaveformContextMenu();

    this.status.set(`Deleted section "${section.label}".`);
  }

  editSectionFromContextMenu(): void {
    const menu = this.waveformContextMenu();
    const song = this.selectedSong();

    if (!menu?.sectionId || !song) {
      return;
    }

    const section = song.sections.find((item) => item.id === menu.sectionId);

    if (!section) {
      return;
    }

    this.sectionNameInput.set(section.label);
    this.sectionColorInput.set(section.color);

    this.sectionEditDialog.set({
      sectionId: section.id
    });

    this.closeWaveformContextMenu();
  }

  cancelSectionEdit(): void {
    this.sectionEditDialog.set(null);
    this.sectionNameInput.set('');
  }

  saveSectionEdit(): void {
    const dialog = this.sectionEditDialog();
    const song = this.selectedSong();

    if (!dialog || !song) {
      return;
    }

    const label = this.sectionNameInput().trim();

    if (!label) {
      this.status.set('Section name cannot be empty.');
      return;
    }

    const sections = song.sections.map((section) =>
      section.id === dialog.sectionId
        ? {
            ...section,
            label,
            color: this.sectionColorInput()
          }
        : section
    );

    this.library.update(song.id, {
      sections
    });

    const updatedSong = this.selectedSong();

    if (updatedSong) {
      void this.sidecars.save(updatedSong).catch((error) => {
        console.error('Automatic sidecar save failed:', error);
        this.status.set(`Section changed, but sidecar save failed: ${this.errorMessage(error)}`);
      });
    }

    this.sectionEditDialog.set(null);
    this.sectionNameInput.set('');

    this.status.set(`Section changed to "${label}".`);
  }

  setSongStartFromContextMenu(): void {
    const menu = this.waveformContextMenu();
    const song = this.selectedSong();

    if (!menu || !song) {
      return;
    }

    const startSeconds = this.clampPracticeTime(song, this.currentTime());
    const endSeconds = this.songEndSeconds(song);

    if (startSeconds >= endSeconds - 0.05) {
      this.status.set('Start point must be before the end point.');
      return;
    }

    this.saveSongBoundaries(song, startSeconds, song.endSeconds);

    if (this.currentTime() < startSeconds) {
      this.currentTime.set(startSeconds);

      this.dsp.seek(startSeconds, this.practiceSpeed() / 100, this.effectiveDspShift(song));
    }

    this.closeWaveformContextMenu();
    this.status.set(`Start point set to ${this.formatTime(startSeconds)}.`);
  }

  setSongEndFromContextMenu(): void {
    const menu = this.waveformContextMenu();
    const song = this.selectedSong();

    if (!menu || !song) {
      return;
    }

    const startSeconds = this.songStartSeconds(song);
    const endSeconds = this.clampPracticeTime(song, this.currentTime());

    if (endSeconds <= startSeconds + 0.05) {
      this.status.set('End point must be after the start point.');
      return;
    }

    this.saveSongBoundaries(song, song.startSeconds, endSeconds);

    if (this.currentTime() > endSeconds) {
      this.dsp.pause();
      this.isPlaying.set(false);
      this.currentTime.set(endSeconds);

      this.dsp.seek(endSeconds, this.practiceSpeed() / 100, this.effectiveDspShift(song));
    }

    this.closeWaveformContextMenu();
    this.status.set(`End point set to ${this.formatTime(endSeconds)}.`);
  }

  clearSongStart(): void {
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    this.saveSongBoundaries(song, undefined, song.endSeconds);
    this.closeWaveformContextMenu();

    this.status.set('Start point cleared.');
  }

  clearSongEnd(): void {
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    this.saveSongBoundaries(song, song.startSeconds, undefined);
    this.closeWaveformContextMenu();

    this.status.set('End point cleared.');
  }

  onWaveformPointerDown(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }

    const audio = this.audioRef?.nativeElement;
    if (!audio) return;

    this.isWaveformScrubbing.set(true);

    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);

    this.updateWaveformScrubPosition(event);
  }

  onWaveformPointerMove(event: PointerEvent): void {
    if (!this.isWaveformScrubbing()) return;

    this.updateWaveformScrubPosition(event);
  }

  onWaveformPointerUp(event: PointerEvent): void {
    if (!this.isWaveformScrubbing()) {
      return;
    }

    const song = this.selectedSong();

    if (!song) return;

    this.updateWaveformScrubPosition(event);

    this.dsp.seek(this.currentTime(), this.practiceSpeed() / 100, this.effectiveDspShift(song));

    this.isWaveformScrubbing.set(false);

    const element = event.currentTarget as HTMLElement;

    if (element.hasPointerCapture(event.pointerId)) {
      element.releasePointerCapture(event.pointerId);
    }
  }

  private updateWaveformScrubPosition(event: PointerEvent): void {
    const song = this.selectedSong();

    if (!song?.durationSeconds) return;

    const waveform = event.currentTarget as HTMLElement;
    const rect = waveform.getBoundingClientRect();

    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));

    const ratio = x / rect.width;
    const rawTime = ratio * song.durationSeconds;
    const time = this.clampPracticeTime(song, rawTime);

    this.currentTime.set(time);
  }

  startCountInEdit(): void {
    this.countInEditValue.set(String(this.countInClicks()));
    this.countInEditing.set(true);

    setTimeout(() => {
      const input = document.querySelector<HTMLInputElement>('.count-in-edit');
      input?.focus();
      input?.select();
    });
  }

  saveCountInEdit(): void {
    const value = Number.parseInt(this.countInEditValue(), 10);

    if (Number.isFinite(value)) {
      this.countInClicks.set(Math.max(1, Math.min(16, value)));
    }

    this.countInEditing.set(false);

    const song = this.selectedSong();

    if (song) {
      this.library.update(song.id, {
        countInClicks: value
      });
    }

    const updatedSong = this.selectedSong();

    if (updatedSong) {
      void this.sidecars.save(updatedSong).catch((error) => {
        console.error('Automatic sidecar save failed:', error);
      });
    }
  }

  cancelCountInEdit(): void {
    this.countInEditing.set(false);
  }

  private playCountInClick(accent = false): void {
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

  private async runCountIn(force = false): Promise<boolean> {
    const song = this.selectedSong();

    if (!song) return false;

    const clicks = this.countInClicks();

    if ((!this.countInEnabled() && !force) || clicks <= 0) {
      return true;
    }

    const bpm = this.effectiveBpm(song);

    if (song.analysisState !== 'ready' || typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0) {
      this.countInEnabled.set(false);
      this.status.set('Count-in requires analyzed BPM.');
      return false;
    }

    const intervalMs = 60000 / bpm;

    const token = ++this.countInCancelToken;

    this.isCountingIn.set(true);

    try {
      for (let i = 0; i < clicks; i++) {
        if (token !== this.countInCancelToken) {
          return false;
        }

        this.status.set(`Count-in ${i + 1} / ${clicks}`);

        this.playCountInClick(i === 0);

        await new Promise<void>((resolve) => window.setTimeout(resolve, intervalMs));
      }

      return token === this.countInCancelToken;
    } finally {
      if (token === this.countInCancelToken) {
        this.isCountingIn.set(false);
      }
    }
  }

  private cancelCountIn(): void {
    this.countInCancelToken++;
    this.isCountingIn.set(false);
  }

  onCountInToggle(event: Event): void {
    const input = event.target as HTMLInputElement;
    const enabled = input.checked;

    this.countInEnabled.set(enabled);

    const song = this.selectedSong();

    if (song) {
      this.library.update(song.id, {
        countInEnabled: enabled
      });
    }

    const updatedSong = this.selectedSong();

    if (updatedSong) {
      void this.sidecars.save(updatedSong).catch((error) => {
        console.error('Automatic sidecar save failed:', error);
      });
    }

    input.blur();
  }

  onLoopCountInToggle(event: Event): void {
    const input = event.target as HTMLInputElement;

    this.loopCountInEnabled.set(input.checked);

    input.blur();
  }

  seekByBeat(direction: -1 | 1): void {
    const song = this.selectedSong();

    if (!song) return;

    const time = this.currentTime();
    // Prefer visible chord-block boundaries once chords exist.
    const anchors =
      song.chords.length > 0
        ? song.chords.map((chord) => song.beats[chord.beatIndex]?.timestampSeconds).filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        : song.beats.map((beat) => beat.timestampSeconds);

    if (!anchors.length) return;

    // Find the current visible block:
    // latest anchor that is <= current playback time.
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
      // Always go to the START of the next block.
      if (currentIndex < anchors.length - 1) {
        targetIndex = currentIndex + 1;
      }
    } else {
      const restartThresholdSeconds = 0.7;
      const currentBlockStart = anchors[currentIndex];

      if (time - currentBlockStart > restartThresholdSeconds) {
        // We're well inside this block:
        // restart this block.
        targetIndex = currentIndex;
      } else if (currentIndex > 0) {
        // Already near its start:
        // go to previous block.
        targetIndex = currentIndex - 1;
      }
    }

    const targetTime = anchors[targetIndex];

    this.currentTime.set(targetTime);

    this.dsp.seek(targetTime, this.practiceSpeed() / 100, this.effectiveDspShift(song));
  }

  async testRealRhythmAnalysis(): Promise<void> {
    this.isAnalyzing.set(true);
    const song = this.selectedSong();

    if (!song?.assetUrl) {
      this.status.set('No song selected.');
      return;
    }

    try {
      this.status.set('Decoding audio...');

      const response = await fetch(song.assetUrl);
      const arrayBuffer = await response.arrayBuffer();

      const audioContext = new AudioContext({
        sampleRate: 44100
      });

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      console.log('Decoded sample rate:', audioBuffer.sampleRate);

      const mono = new Float32Array(audioBuffer.length);

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const data = audioBuffer.getChannelData(channel);

        for (let i = 0; i < data.length; i++) {
          mono[i] += data[i] / audioBuffer.numberOfChannels;
        }
      }

      await audioContext.close();

      this.status.set('Analyzing song...');

      const worker = new Worker(new URL('./workers/essentia.worker', import.meta.url), { type: 'module' });

      worker.onmessage = ({ data }) => {
        if (data.type === 'rhythm-result') {
          console.log('Detected BPM:', data.bpm);
          console.log('Detected beats:', data.ticks);

          const beats = data.ticks.map((timestampSeconds: number, index: number) => ({
            id: `beat-${index}`,
            index,
            timestampSeconds
          }));

          this.library.update(song.id, {
            bpm: data.bpm,
            beats,
            analysisState: 'ready'
          });

          this.status.set(`Detected BPM: ${Number(data.bpm).toFixed(2)} | Beats: ${beats.length}`);

          this.isAnalyzing.set(false);
          worker.terminate();
        }

        if (data.type === 'error') {
          console.error('Essentia analysis error:', data.message);
          this.status.set(`Essentia analysis error: ${data.message}`);
          this.isAnalyzing.set(false);
          worker.terminate();
        }
      };

      worker.onerror = (error) => {
        console.error('Essentia worker error:', error);
        this.status.set(`Essentia worker error: ${error.message}`);
        this.isAnalyzing.set(false);
        worker.terminate();
      };

      worker.postMessage(
        {
          type: 'analyze-rhythm',
          samples: mono.buffer
        },
        [mono.buffer]
      );
    } catch (error) {
      this.isAnalyzing.set(false);
      this.status.set(`Analysis error: ${this.errorMessage(error)}`);
    }
  }

  private createWaveformPeaks(samples: Float32Array, bucketCount = 600): number[] {
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

      if (rms > strongestLevel) {
        strongestLevel = rms;
      }
    }

    if (strongestLevel <= 0) {
      return levels.map(() => 0);
    }

    return levels.map((level) => level / strongestLevel);
  }

  private async decodeAnalysisAudio(assetUrl: string): Promise<{
    mono: Float32Array;
    left: Float32Array;
    right: Float32Array;
    sampleRate: number;
  }> {
    const response = await fetch(assetUrl);
    const arrayBuffer = await response.arrayBuffer();

    const audioContext = new AudioContext({
      sampleRate: 44100
    });

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

  async analyzeSong(song: Song, sourceTuningOverrideHz: number | null = null): Promise<void> {
    if (!song.assetUrl) {
      this.library.update(song.id, {
        analysisState: 'error'
      });

      this.status.set('Song has no audio source.');

      this.finishAnalysisQueueItem(song.id);
      return;
    }

    try {
      this.isAnalyzing.set(true);

      this.library.update(song.id, {
        analysisState: 'detecting-tuning'
      });

      this.status.set('Decoding audio...');

      const { mono, left, right } = await this.decodeAnalysisAudio(song.assetUrl);

      const waveformPeaks = this.createWaveformPeaks(mono);

      const worker = new Worker(new URL('./workers/essentia.worker', import.meta.url), { type: 'module' });

      worker.onmessage = ({ data }) => {
        if (data.type === 'tuning-result') {
          const tuningCents = Number(data.tuningCents);

          const detectedTuningHz = Number(data.tuningFrequency);

          console.log(`Tuning detected for ${song.fileName}:`, detectedTuningHz, 'Hz', tuningCents, 'cents');

          song.detectedTuningHz = detectedTuningHz;

          song.sourceTuningHz = detectedTuningHz;

          song.tuningCents = tuningCents;

          this.library.update(song.id, {
            detectedTuningHz,
            sourceTuningHz: detectedTuningHz,
            tuningCents
          });

          this.sourceTuningInput.set(Math.round(detectedTuningHz));

          const tuningNeedsAttention = Math.abs(tuningCents) >= 8;

          if (tuningNeedsAttention) {
            this.library.update(song.id, {
              analysisState: 'awaiting-tuning-choice'
            });

            this.pendingTuningAnalysis = {
              songId: song.id,
              worker,
              mono,
              left,
              right
            };

            this.tuningChoicePrompt.set({
              songId: song.id,
              fileName: song.fileName,
              detectedHz: detectedTuningHz,
              tuningCents
            });

            this.isAnalyzing.set(false);

            this.status.set(`Tuning choice required for ${song.fileName}`);

            return;
          }

          song.detectedTuningHz = detectedTuningHz;
          song.sourceTuningHz = detectedTuningHz;
          song.tuningCents = tuningCents;

          this.library.update(song.id, {
            detectedTuningHz,
            sourceTuningHz: detectedTuningHz,
            tuningCents,
            analysisState: 'analyzing'
          });

          this.status.set('Analyzing BPM and chords...');

          const loudnessStartSeconds = this.songStartSeconds(song);
          const loudnessEndSeconds = this.songEndSeconds(song);

          worker.postMessage(
            {
              type: 'full-analysis',
              samples: mono.buffer,
              left: left.buffer,
              right: right.buffer,
              tuningFrequency: detectedTuningHz,
              loudnessStartSeconds,
              loudnessEndSeconds
            },
            [mono.buffer, left.buffer, right.buffer]
          );

          return;
        }
        if (data.type === 'full-analysis-result') {
          const keyTonic = typeof data.keyTonic === 'string' ? data.keyTonic : null;

          const keyMode: 'major' | 'minor' | null = data.keyMode === 'major' || data.keyMode === 'minor' ? data.keyMode : null;

          console.log('Detected song key:', keyTonic, keyMode);

          const beats = data.ticks.map((timestampSeconds: number, index: number) => ({
            id: `beat-${index}`,
            index,
            timestampSeconds
          }));

          const chords: ChordEvent[] = data.chords
            .map((result: { beatIndex: number; chord: string; spanBeats?: number }) => {
              const beatIndex = result.beatIndex;
              const beat = beats[beatIndex];

              if (!beat) return null;

              return {
                id: `chord-${beatIndex}`,
                beatId: beat.id,
                beatIndex,
                canonicalChord: result.chord,
                spanBeats: result.spanBeats ?? 1
              } satisfies ChordEvent;
            })
            .filter((chord: ChordEvent | null): chord is ChordEvent => chord !== null);

          this.library.update(song.id, {
            bpm: data.bpm,
            beats,
            chords,
            waveformPeaks,

            keyTonic,
            keyMode,

            loudnessLufs: Number.isFinite(data.loudnessLufs) ? data.loudnessLufs : undefined,

            analysisState: 'ready'
          });

          const analyzedSong: Song = {
            ...song,

            bpm: data.bpm,
            beats,
            chords,
            waveformPeaks,

            keyTonic,
            keyMode,

            loudnessLufs: Number.isFinite(data.loudnessLufs) ? data.loudnessLufs : undefined,

            analysisState: 'ready'
          };

          void this.sidecars.save(analyzedSong).catch((error) => {
            console.error(`Automatic sidecar save failed for ${song.fileName}:`, error);
          });

          this.status.set(`Analysis complete: ${Math.round(data.bpm)} BPM, ${beats.length} beats, ${chords.length} chords`);

          this.isAnalyzing.set(false);
          worker.terminate();

          this.finishAnalysisQueueItem(song.id);
        }

        if (data.type === 'error') {
          this.library.update(song.id, {
            analysisState: 'error'
          });

          this.status.set(`Analysis error: ${data.message}`);
          this.isAnalyzing.set(false);
          worker.terminate();

          this.finishAnalysisQueueItem(song.id);
        }
      };

      worker.onerror = (error) => {
        this.library.update(song.id, {
          analysisState: 'error'
        });

        this.status.set(`Analysis error: ${error.message}`);
        this.isAnalyzing.set(false);
        worker.terminate();

        this.finishAnalysisQueueItem(song.id);
      };

      if (sourceTuningOverrideHz != null) {
        this.library.update(song.id, {
          sourceTuningHz: sourceTuningOverrideHz,
          analysisState: 'analyzing'
        });

        this.status.set(`Analyzing ${song.fileName} using A=${sourceTuningOverrideHz.toFixed(1)} Hz...`);

        const loudnessStartSeconds = this.songStartSeconds(song);
        const loudnessEndSeconds = this.songEndSeconds(song);

        worker.postMessage(
          {
            type: 'full-analysis',
            samples: mono.buffer,
            left: left.buffer,
            right: right.buffer,
            tuningFrequency: sourceTuningOverrideHz,
            loudnessStartSeconds,
            loudnessEndSeconds
          },
          [mono.buffer, left.buffer, right.buffer]
        );

        return;
      }

      this.status.set('Detecting tuning...');

      const tuningSamples = mono.slice();

      worker.postMessage(
        {
          type: 'analyze-tuning',
          samples: tuningSamples.buffer
        },
        [tuningSamples.buffer]
      );
    } catch (error) {
      this.library.update(song.id, {
        analysisState: 'error'
      });

      this.isAnalyzing.set(false);
      this.status.set(`Analysis error: ${this.errorMessage(error)}`);

      this.finishAnalysisQueueItem(song.id);
    }
  }

  private async recalculateSongLoudness(song: Song): Promise<void> {
    if (!song.assetUrl) {
      return;
    }

    const generation = (this.loudnessAnalysisGenerations.get(song.id) ?? 0) + 1;

    this.loudnessAnalysisGenerations.set(song.id, generation);

    try {
      const { left, right } = await this.decodeAnalysisAudio(song.assetUrl);

      const worker = new Worker(new URL('./workers/essentia.worker', import.meta.url), { type: 'module' });

      worker.onmessage = ({ data }) => {
        if (data.type === 'loudness-result') {
          if (this.loudnessAnalysisGenerations.get(song.id) !== generation) {
            console.log('Ignoring stale loudness result:', {
              song: song.fileName,
              generation
            });

            worker.terminate();
            return;
          }

          const loudnessLufs = Number(data.loudnessLufs);

          if (Number.isFinite(loudnessLufs)) {
            this.library.update(song.id, {
              loudnessLufs
            });

            const updatedSong = this.library.songs().find((item) => item.id === song.id);

            if (updatedSong) {
              void this.sidecars.save(updatedSong).catch((error) => {
                console.error(`Could not save recalculated loudness for ${song.fileName}:`, error);
              });
            }

            console.log('Loudness recalculated:', {
              song: song.fileName,
              loudnessLufs,
              startSeconds: data.startSeconds,
              endSeconds: data.endSeconds
            });
          }

          worker.terminate();
          return;
        }

        if (data.type === 'error') {
          if (this.loudnessAnalysisGenerations.get(song.id) === generation) {
            console.error(`Loudness recalculation failed for ${song.fileName}:`, data.message);
          }

          worker.terminate();
        }
      };

      worker.onerror = (error) => {
        if (this.loudnessAnalysisGenerations.get(song.id) === generation) {
          console.error(`Loudness worker failed for ${song.fileName}:`, error);
        }

        worker.terminate();
      };

      worker.postMessage(
        {
          type: 'analyze-loudness',
          left: left.buffer,
          right: right.buffer,
          startSeconds: this.songStartSeconds(song),
          endSeconds: this.songEndSeconds(song)
        },
        [left.buffer, right.buffer]
      );
    } catch (error) {
      console.error(`Could not recalculate loudness for ${song.fileName}:`, error);
    }
  }

  private enqueueAnalysis(song: Song): void {
    const alreadyQueued = this.analysisQueue.some((item) => item.id === song.id);

    const alreadyRunning = this.currentAnalysisSongId === song.id;

    if (alreadyQueued || alreadyRunning) {
      return;
    }

    this.library.update(song.id, {
      analysisState: 'queued'
    });

    this.analysisQueue.push(song);

    this.processNextAnalysis();
  }

  private processNextAnalysis(): void {
    if (this.currentAnalysisSongId) {
      return;
    }

    const nextSong = this.analysisQueue.shift();

    if (!nextSong) {
      return;
    }

    this.currentAnalysisSongId = nextSong.id;

    void this.analyzeSong(nextSong);
  }

  private finishAnalysisQueueItem(songId: string): void {
    if (this.currentAnalysisSongId === songId) {
      this.currentAnalysisSongId = null;
    }

    this.processNextAnalysis();
  }

  async saveSidecar(): Promise<void> {
    const song = this.selectedSong();
    if (!song) return;
    try {
      const path = await this.sidecars.save(song);
      this.status.set(`Saved sidecar: ${path}`);
    } catch (error) {
      this.status.set(this.errorMessage(error));
    }
  }

  tuningCorrectionCents(sourceHz: number, targetHz = 440): number {
    if (!Number.isFinite(sourceHz) || sourceHz <= 0 || !Number.isFinite(targetHz) || targetHz <= 0) {
      return 0;
    }

    return 1200 * Math.log2(targetHz / sourceHz);
  }

  onSourceTuningChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const value = Number(input.value);

    this.sourceTuningInput.set(value);

    if (!this.sourceTuningIsValid()) {
      return;
    }

    const song = this.selectedSong();
    if (!song) return;

    this.library.update(song.id, {
      sourceTuningHz: Math.round(value)
    });
  }

  applyTuningCorrection(): void {
    const song = this.selectedSong();
    const sourceHz = this.sourceTuningInput();

    if (!song || sourceHz == null || !this.sourceTuningIsValid()) {
      return;
    }

    const roundedSourceHz = Math.round(sourceHz);

    const correctionCents = this.tuningCorrectionCents(roundedSourceHz, 440);

    const tuningCorrectionEnabled = Math.abs(correctionCents) >= 0.01;

    const updatedSong: Song = {
      ...song,
      sourceTuningHz: roundedSourceHz,
      tuningCorrectionEnabled,
      tuningCorrectionCents: tuningCorrectionEnabled ? correctionCents : 0,
      analysisState: 'analyzing'
    };

    this.library.update(song.id, {
      sourceTuningHz: roundedSourceHz,
      tuningCorrectionEnabled,
      tuningCorrectionCents: tuningCorrectionEnabled ? correctionCents : 0,
      analysisState: 'analyzing'
    });

    this.dsp.pause();
    this.isPlaying.set(false);
    this.currentTime.set(0);

    this.status.set(tuningCorrectionEnabled ? `Source tuning set to ${roundedSourceHz} Hz. Re-analyzing...` : 'Source tuning set to 440 Hz. Re-analyzing without tuning correction...');

    void this.sidecars.save(updatedSong).catch((error) => {
      console.error(`Failed to save tuning settings for ${song.fileName}:`, error);
    });

    void this.analyzeSong(updatedSong, roundedSourceHz);
  }

  resetTuning(): void {
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    this.dsp.pause();
    this.isPlaying.set(false);
    this.currentTime.set(0);

    this.sourceTuningInput.set(440);

    const updatedSong: Song = {
      ...song,
      sourceTuningHz: 440,
      tuningCorrectionEnabled: false,
      tuningCorrectionCents: 0,
      tuningCents: 0,
      analysisState: 'analyzing'
    };

    this.library.update(song.id, {
      sourceTuningHz: 440,
      tuningCorrectionEnabled: false,
      tuningCorrectionCents: 0,
      tuningCents: 0,
      analysisState: 'analyzing'
    });

    this.status.set('Tuning reset to A=440. Re-analyzing...');

    void this.sidecars.save(updatedSong).catch((error) => {
      console.error(`Failed to save reset tuning for ${song.fileName}:`, error);
    });

    void this.analyzeSong(updatedSong, 440);
  }

  keepOriginalTuning(): void {
    this.continueAfterTuningChoice(false);
  }

  tuneTo440(): void {
    this.continueAfterTuningChoice(true);
  }

  private continueAfterTuningChoice(tuneTo440: boolean): void {
    const prompt = this.tuningChoicePrompt();

    const pending = this.pendingTuningAnalysis;

    if (!prompt || !pending || prompt.songId !== pending.songId) {
      return;
    }

    const song = this.library.songs().find((item) => item.id === prompt.songId);

    if (!song) {
      pending.worker.terminate();

      this.pendingTuningAnalysis = null;
      this.tuningChoicePrompt.set(null);

      this.finishAnalysisQueueItem(prompt.songId);

      return;
    }

    const sourceHz = prompt.detectedHz;

    const correctionCents = tuneTo440 ? this.tuningCorrectionCents(sourceHz, 440) : 0;

    song.sourceTuningHz = sourceHz;

    song.tuningCorrectionEnabled = tuneTo440;

    song.tuningCorrectionCents = correctionCents;

    this.library.update(song.id, {
      sourceTuningHz: sourceHz,

      tuningCorrectionEnabled: tuneTo440,

      tuningCorrectionCents: correctionCents,

      analysisState: 'analyzing'
    });

    this.sourceTuningInput.set(Math.round(sourceHz));

    this.tuningChoicePrompt.set(null);

    this.pendingTuningAnalysis = null;

    this.isAnalyzing.set(true);

    this.status.set(tuneTo440 ? `Analyzing ${song.fileName} with tuning corrected to A=440...` : `Analyzing ${song.fileName} at original tuning...`);

    try {
      const loudnessStartSeconds = this.songStartSeconds(song);
      const loudnessEndSeconds = this.songEndSeconds(song);

      pending.worker.postMessage(
        {
          type: 'full-analysis',
          samples: pending.mono.buffer,
          left: pending.left.buffer,
          right: pending.right.buffer,
          tuningFrequency: sourceHz,
          loudnessStartSeconds,
          loudnessEndSeconds
        },
        [pending.mono.buffer, pending.left.buffer, pending.right.buffer]
      );
    } catch (error) {
      console.error('Failed to continue analysis after tuning choice:', error);

      pending.worker.terminate();

      this.pendingTuningAnalysis = null;
      this.tuningChoicePrompt.set(null);

      this.library.update(song.id, {
        analysisState: 'error'
      });

      this.isAnalyzing.set(false);

      this.status.set(`Analysis error: ${this.errorMessage(error)}`);

      this.finishAnalysisQueueItem(song.id);
    }
  }

  sourceTuningIsValid(): boolean {
    const value = this.sourceTuningInput();

    return value != null && Number.isFinite(value) && value >= 400 && value <= 480;
  }

  sourceTuningError(): string {
    const value = this.sourceTuningInput();

    if (value == null || !Number.isFinite(value)) {
      return 'Enter a source pitch.';
    }

    if (value < 400 || value > 480) {
      return 'Source pitch must be between 400 and 480 Hz.';
    }

    return '';
  }

  async changeTab(nextTab: Tab): Promise<void> {
    // Leaving Practice
    if (this.tab() === 'practice' && nextTab !== 'practice') {
      const audio = this.audioRef?.nativeElement;

      if (audio) {
        audio.pause();
      }

      this.cancelCountIn();

      this.dsp.pause();

      this.isPlaying.set(false);

      this.stopPlaybackClock();
    }

    // Leaving Live
    if (this.tab() === 'live' && nextTab !== 'live') {
      this.stopLivePlayback();
    }

    this.tab.set(nextTab);

    // Entering Practice:
    // reload the selected Practice song because Live may have
    // replaced the DSP buffer with another playlist song.
    if (nextTab === 'practice') {
      const song = this.selectedSong();

      if (!song) {
        return;
      }

      const startSeconds = this.songStartSeconds(song);

      this.currentTime.set(startSeconds);

      this.isPlaying.set(false);

      this.countInEnabled.set(song.countInEnabled);

      this.countInClicks.set(song.countInClicks);

      setTimeout(() => {
        this.loadAudio();

        void this.loadDspAudio(song);
      }, 0);

      return;
    }

    // Entering Live:
    // prepare duration immediately so Start/End markers can be
    // positioned before the user presses Start Live.
    if (nextTab === 'live') {
      const song = this.liveCurrentSong();

      if (!song) {
        return;
      }

      try {
        await this.ensureSongDuration(song);

        this.liveCurrentTime.set(this.songStartSeconds(song));
      } catch (error) {
        console.error('Could not prepare Live song:', error);
      }
    }
  }

  async sendMidiTest(): Promise<void> {
    const device = this.activeMidiDevice();
    if (!device) {
      this.status.set('No MIDI output selected.');
      return;
    }
    const channel = Math.max(1, Math.min(16, this.midiChannel)) - 1;
    let bytes: number[];
    if (this.midiKind === 'program-change') bytes = [0xc0 | channel, Math.max(0, Math.min(127, this.midiData1))];
    else if (this.midiKind === 'control-change') bytes = [0xb0 | channel, Math.max(0, Math.min(127, this.midiData1)), Math.max(0, Math.min(127, this.midiData2))];
    else bytes = [0xf8]; // harmless MIDI timing-clock byte as a raw-mode placeholder

    try {
      await this.backend.sendMidiBytes(device, bytes);
      this.status.set(`MIDI sent to ${device}: ${bytes.map((v) => `0x${v.toString(16).padStart(2, '0')}`).join(' ')}`);
    } catch (error) {
      this.status.set(this.errorMessage(error));
    }
  }

  async startMidiInputListening(): Promise<void> {
    const deviceName = this.activeMidiInputDevice();

    if (!deviceName) {
      this.status.set('No MIDI input selected.');
      return;
    }

    try {
      await this.stopMidiInputListening();

      this.midiInputUnlisten = await listen<{
        timestamp: number;
        bytes: number[];
      }>('midi-input-message', (event) => {
        this.lastMidiInputMessage.set(event.payload);

        this.midiInputMessages.update((messages) => [
          ...messages.slice(-19),
          {
            receivedAt: Date.now(),
            timestamp: event.payload.timestamp,
            bytes: event.payload.bytes
          }
        ]);

        console.log('MIDI input:', {
          device: deviceName,
          timestamp: event.payload.timestamp,
          bytes: event.payload.bytes
        });
      });

      await this.backend.startMidiInputListener(deviceName);

      this.midiInputListening.set(true);
      this.status.set(`Listening for MIDI input from ${deviceName}.`);
    } catch (error) {
      this.midiInputListening.set(false);
      this.status.set(`Could not start MIDI input: ${this.errorMessage(error)}`);
    }
  }

  async stopMidiInputListening(): Promise<void> {
    try {
      await this.backend.stopMidiInputListener();
    } catch (error) {
      console.warn('Could not stop MIDI input listener:', error);
    }

    if (this.midiInputUnlisten) {
      this.midiInputUnlisten();
      this.midiInputUnlisten = null;
    }

    this.midiInputListening.set(false);
  }

  formatMidiBytes(bytes: number[]): string {
    return bytes.map((value) => value.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  }

  midiMessageToClipboardJson(bytes: number[]): string | null {
    if (!bytes.length) {
      return null;
    }

    const status = bytes[0];
    const messageType = status & 0xf0;
    const channel = (status & 0x0f) + 1;

    if (messageType === 0xc0) {
      return JSON.stringify({
        kind: 'program-change',
        channel,
        data1: bytes[1] ?? 0
      });
    }

    if (messageType === 0xb0) {
      return JSON.stringify({
        kind: 'control-change',
        channel,
        data1: bytes[1] ?? 0,
        data2: bytes[2] ?? 0
      });
    }

    return JSON.stringify({
      kind: 'raw',
      channel,
      data1: 0,
      rawBytes: bytes
    });
  }

  async copyMidiInputMessage(bytes: number[]): Promise<void> {
    const json = this.midiMessageToClipboardJson(bytes);

    if (!json) {
      this.status.set('Nothing to copy.');
      return;
    }

    try {
      await navigator.clipboard.writeText(json);
      this.status.set('MIDI event copied to clipboard.');
    } catch (error) {
      this.status.set(`Could not copy MIDI event: ${this.errorMessage(error)}`);
    }
  }

  decodeMidiMessage(bytes: number[]): string {
    if (!bytes.length) {
      return 'Empty MIDI message';
    }

    const status = bytes[0];
    const messageType = status & 0xf0;
    const channel = (status & 0x0f) + 1;

    if (messageType === 0xc0) {
      const program = bytes[1] ?? 0;
      return `Program Change · Ch ${channel} · Program ${program}`;
    }

    if (messageType === 0xb0) {
      const controller = bytes[1] ?? 0;
      const value = bytes[2] ?? 0;
      return `Control Change · Ch ${channel} · CC ${controller} · Value ${value}`;
    }

    if (messageType === 0x90) {
      const note = bytes[1] ?? 0;
      const velocity = bytes[2] ?? 0;

      if (velocity === 0) {
        return `Note Off · Ch ${channel} · Note ${note}`;
      }

      return `Note On · Ch ${channel} · Note ${note} · Velocity ${velocity}`;
    }

    if (messageType === 0x80) {
      const note = bytes[1] ?? 0;
      const velocity = bytes[2] ?? 0;
      return `Note Off · Ch ${channel} · Note ${note} · Velocity ${velocity}`;
    }

    if (messageType === 0xe0) {
      const lsb = bytes[1] ?? 0;
      const msb = bytes[2] ?? 0;
      const value = (msb << 7) | lsb;
      return `Pitch Bend · Ch ${channel} · Value ${value}`;
    }

    if (messageType === 0xd0) {
      const pressure = bytes[1] ?? 0;
      return `Channel Pressure · Ch ${channel} · Value ${pressure}`;
    }

    if (messageType === 0xa0) {
      const note = bytes[1] ?? 0;
      const pressure = bytes[2] ?? 0;
      return `Poly Pressure · Ch ${channel} · Note ${note} · Value ${pressure}`;
    }

    if (status >= 0xf0) {
      return `System MIDI · ${this.formatMidiBytes(bytes)}`;
    }

    return `Unknown MIDI · ${this.formatMidiBytes(bytes)}`;
  }

  formatMidiInputTime(timestampMs: number): string {
    return new Date(timestampMs).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  }

  clearMidiInputMessages(): void {
    this.midiInputMessages.set([]);
    this.lastMidiInputMessage.set(null);
  }

  formatTime = formatTime;
  displaySongKey = displaySongKey;

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  playlistSongs(): Array<{
    entry: PlaylistEntry;
    song: Song | null;
  }> {
    const songs = this.library.songs();

    return this.playlist().entries.map((entry) => ({
      entry,
      song: songs.find((item) => item.id === entry.songId) ?? null
    }));
  }

  liveLoudnessTargetLufs(): number | null {
    const loudnessValues = this.playlistSongs()
      .map((item) => item.song?.loudnessLufs)
      .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

    if (!loudnessValues.length) {
      return null;
    }

    return Math.min(...loudnessValues);
  }

  liveLoudnessGainDb(song: Song): number | null {
    const target = this.liveLoudnessTargetLufs();

    if (target == null || !this.hasValidLoudness(song)) {
      return null;
    }

    return Math.min(0, target - song.loudnessLufs!);
  }

  hasValidLoudness(song: Song): boolean {
    return typeof song.loudnessLufs === 'number' && Number.isFinite(song.loudnessLufs);
  }

  liveCurrentEntry(): PlaylistEntry | null {
    return this.playlist().entries[this.liveCurrentIndex()] ?? null;
  }

  liveCurrentSong(): Song | null {
    const entry = this.liveCurrentEntry();

    if (!entry) {
      return null;
    }

    return this.library.songs().find((song) => song.id === entry.songId) ?? null;
  }

  liveNextSong(): Song | null {
    const nextEntry = this.playlist().entries[this.liveCurrentIndex() + 1];

    if (!nextEntry) {
      return null;
    }

    return this.library.songs().find((song) => song.id === nextEntry.songId) ?? null;
  }

  liveDisplayedChords(song: Song): Array<
    ChordEvent & {
      displayed: string;
    }
  > {
    return song.chords.map((chord) => ({
      ...chord,

      displayed: transposeChord(chord.canonicalChord, song.transposeSemitones)
    }));
  }

  liveCurrentChord(song: Song):
    | (ChordEvent & {
        displayed: string;
      })
    | null {
    const time = this.chordDisplayTime(song, this.liveCurrentTime());

    for (let i = song.chords.length - 1; i >= 0; i--) {
      const chord = song.chords[i];

      const beat = song.beats[chord.beatIndex];

      if (!beat) {
        continue;
      }

      if (beat.timestampSeconds <= time + 0.01) {
        return {
          ...chord,

          displayed: transposeChord(chord.canonicalChord, song.transposeSemitones)
        };
      }
    }

    const first = song.chords[0];

    return first
      ? {
          ...first,

          displayed: transposeChord(first.canonicalChord, song.transposeSemitones)
        }
      : null;
  }

  liveChordTimelineTransform(song: Song): string {
    const time = this.chordDisplayTime(song, this.liveCurrentTime());

    if (!song.beats.length) {
      return 'translateX(0px)';
    }

    const beats = song.beats;

    let currentBeatIndex = 0;

    for (let i = 0; i < beats.length; i++) {
      if (beats[i].timestampSeconds <= time) {
        currentBeatIndex = i;
      } else {
        break;
      }
    }

    const currentBeat = beats[currentBeatIndex];

    const nextBeat = beats[currentBeatIndex + 1];

    let fractionalBeatIndex = currentBeatIndex;

    if (currentBeat && nextBeat) {
      const span = nextBeat.timestampSeconds - currentBeat.timestampSeconds;

      if (span > 0) {
        const progress = Math.max(
          0,
          Math.min(
            1,

            (time - currentBeat.timestampSeconds) / span
          )
        );

        fractionalBeatIndex += progress;
      }
    }

    const offsetPx = fractionalBeatIndex * this.chordWidthPx;

    return `translateX(-${offsetPx}px)`;
  }

  chordIsInsideActiveLoop(chord: ChordEvent): boolean {
    const song = this.selectedSong();
    const loopSection = this.activeLoopSection();

    if (!song || !loopSection) {
      return true;
    }

    const startBeat = song.beats[chord.beatIndex];

    if (!startBeat) {
      return false;
    }

    const chordStart = startBeat.timestampSeconds;

    const nextBeatIndex = chord.beatIndex + (chord.spanBeats ?? 1);
    const nextBeat = song.beats[nextBeatIndex];

    const chordEnd = nextBeat?.timestampSeconds ?? song.durationSeconds ?? chordStart;

    return chordEnd > loopSection.startSeconds && chordStart < loopSection.endSeconds;
  }

  liveMidiEventLeftPx(song: Song, event: MidiEvent): number {
    const beat = song.beats.find((item) => item.id === event.anchorBeatId);

    if (!beat) {
      return 0;
    }

    return beat.index * this.chordWidthPx;
  }

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
    this.scrollActiveLivePlaylistIntoView();

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

  addSongToPlaylist(song: Song): void {
    if (song.analysisState !== 'ready') {
      this.status.set(`${song.fileName} must be analyzed before adding it to Live.`);
      return;
    }

    const playlist = this.playlist();

    if (playlist.entries.some((entry) => entry.songId === song.id)) {
      this.status.set(`${song.fileName} is already in the Live playlist.`);
      return;
    }

    const entry: PlaylistEntry = {
      id: `${song.id}-${Date.now()}`,
      songId: song.id,
      pauseAfterEnabled: true
    };

    this.playlist.set({
      ...playlist,
      entries: [...playlist.entries, entry]
    });

    this.status.set(`Added ${song.fileName} to Live playlist.`);
  }

  isSongInPlaylist(songId: string): boolean {
    return this.playlist().entries.some((entry) => entry.songId === songId);
  }

  reorderPlaylist(event: CdkDragDrop<PlaylistEntry[]>): void {
    if (event.previousIndex === event.currentIndex) {
      return;
    }

    const playlist = this.playlist();

    const entries = [...playlist.entries];

    moveItemInArray(entries, event.previousIndex, event.currentIndex);

    this.playlist.set({
      ...playlist,
      entries
    });

    this.liveCurrentIndex.set(event.currentIndex);
  }

  async saveLivePlaylist(): Promise<void> {
    const playlist = this.playlist();

    if (!playlist.entries.length) {
      this.status.set('Live playlist is empty.');
      return;
    }

    try {
      const safeName = playlist.name.trim() || 'Live Set';

      const path = await this.backend.chooseMusicAssistantSaveFile(`${safeName}.musicassistant`);

      if (!path) {
        return;
      }

      await this.musicAssistantFiles.savePlaylist(path, playlist, this.library.songs());

      this.status.set(`Saved Live set: ${path}`);
    } catch (error) {
      this.status.set(`Could not save Live set: ${this.errorMessage(error)}`);
    }
  }

  async openLivePlaylist(): Promise<void> {
    try {
      const path = await this.backend.chooseMusicAssistantFile();

      if (!path) {
        return;
      }

      await this.openLivePlaylistFromPath(path);
    } catch (error) {
      this.status.set(`Could not open set: ${this.errorMessage(error)}`);
    }
  }

  private async openLivePlaylistFromPath(path: string): Promise<void> {
    this.status.set('Opening Music Assistant set...');

    const file = await this.musicAssistantFiles.load(path);

    const resolvedSongIds = new Map<string, string>();

    for (const songRef of file.songs) {
      let song: Song | null | undefined = this.library.songs().find((item) => item.fingerprintSha256 === songRef.fingerprintSha256);

      if (!song) {
        this.status.set(`Loading ${songRef.fileName}...`);

        song = await this.importSongFromPath(songRef.sourcePath);
      }

      if (!song || song.fingerprintSha256 !== songRef.fingerprintSha256) {
        continue;
      }

      resolvedSongIds.set(songRef.songId, song.id);
    }

    const songRefs = new Map(file.songs.map((song) => [song.songId, song]));

    const entries: PlaylistEntry[] = file.playlist.entries.map((entry) => {
      const resolvedSongId = resolvedSongIds.get(entry.songId);
      const songRef = songRefs.get(entry.songId);

      if (resolvedSongId) {
        return {
          ...entry,
          songId: resolvedSongId,
          fileName: songRef?.fileName,
          fingerprintSha256: songRef?.fingerprintSha256,
          sourcePath: songRef?.sourcePath,
          offline: false
        };
      }

      return {
        ...entry,
        fileName: songRef?.fileName ?? entry.songId,
        fingerprintSha256: songRef?.fingerprintSha256,
        sourcePath: songRef?.sourcePath,
        offline: true
      };
    });

    this.stopLivePlayback();

    this.playlist.set({
      schemaVersion: 1,
      id: file.playlist.id,
      name: file.name,
      pauseBetweenSongsEnabled: file.playlist.pauseBetweenSongsEnabled,
      pauseBetweenSongsSeconds: file.playlist.pauseBetweenSongsSeconds,
      entries
    });

    this.liveCurrentIndex.set(0);
    this.tab.set('live');

    const firstOfflineEntry = entries.find((entry) => entry.offline);

    if (firstOfflineEntry) {
      this.status.set(`Opened set with missing audio: ${firstOfflineEntry.fileName ?? firstOfflineEntry.songId}`);
      this.showNextOfflineSongDialog();
    } else {
      this.status.set(`Opened set: ${file.name}`);
    }
  }

  removeSongFromPlaylist(entryId: string): void {
    const playlist = this.playlist();

    const entries = playlist.entries.filter((entry) => entry.id !== entryId);

    this.playlist.set({
      ...playlist,
      entries
    });

    const maxIndex = Math.max(0, entries.length - 1);

    this.liveCurrentIndex.set(Math.min(this.liveCurrentIndex(), maxIndex));
  }

  async locateOfflinePlaylistSong(entry: PlaylistEntry): Promise<void> {
    if (!entry.fingerprintSha256) {
      this.status.set(`Cannot relink ${entry.fileName ?? entry.songId}: saved fingerprint is missing.`);
      return;
    }

    try {
      const path = await this.backend.chooseAudioReplacementFile();

      if (!path) {
        return;
      }

      this.status.set(`Checking ${entry.fileName ?? 'selected audio file'}...`);

      const hash = await this.backend.hashFile(path);

      if (hash !== entry.fingerprintSha256) {
        this.showInvalidSongDialog(entry);
        this.status.set(`Selected file does not match ${entry.fileName ?? 'the missing song'}.`);
        return;
      }

      const song = await this.importSongFromPath(path);

      if (!song) {
        this.status.set(`Could not import replacement file for ${entry.fileName ?? entry.songId}.`);
        return;
      }

      if (song.fingerprintSha256 !== entry.fingerprintSha256) {
        this.showInvalidSongDialog(entry);
        this.status.set(`Selected file does not match ${entry.fileName ?? 'the missing song'}.`);
        return;
      }

      const playlist = this.playlist();

      const entries = playlist.entries.map((item) =>
        item.id === entry.id
          ? {
              ...item,
              songId: song.id,
              fileName: song.fileName,
              fingerprintSha256: song.fingerprintSha256,
              sourcePath: song.sourcePath,
              offline: false
            }
          : item
      );

      this.playlist.set({
        ...playlist,
        entries
      });

      this.status.set(`Relinked ${song.fileName}.`);

      this.showNextOfflineSongDialog();
    } catch (error) {
      this.status.set(`Could not relink song: ${this.errorMessage(error)}`);
    }
  }

  async searchFolderForOfflineSong(entry: PlaylistEntry): Promise<void> {
    try {
      const folder = await this.backend.chooseFolder();

      if (!folder) {
        return;
      }

      this.closeRecoveryDialog();

      const offlineEntries = this.playlist().entries.filter((item) => item.offline && item.fingerprintSha256);

      if (!offlineEntries.length) {
        this.status.set('No missing songs to locate.');
        return;
      }

      this.status.set(`Scanning folder for ${offlineEntries.length} missing song${offlineEntries.length === 1 ? '' : 's'}...`);

      const paths = await this.backend.listAudioFilesRecursive(folder);

      if (!paths.length) {
        this.recoveryDialog.set({
          title: 'No audio files found',
          message: 'The selected folder does not contain any MP3 or WAV files.',
          entry,
          kind: 'info'
        });
        return;
      }

      const missingByFingerprint = new Map<string, PlaylistEntry>();

      for (const offlineEntry of offlineEntries) {
        if (offlineEntry.fingerprintSha256) {
          missingByFingerprint.set(offlineEntry.fingerprintSha256, offlineEntry);
        }
      }

      const matches = new Map<string, string>();

      for (let index = 0; index < paths.length; index++) {
        if (!missingByFingerprint.size) {
          break;
        }

        const path = paths[index];

        this.status.set(`Scanning audio files ${index + 1} of ${paths.length}...`);

        const hash = await this.backend.hashFile(path);

        if (missingByFingerprint.has(hash)) {
          matches.set(hash, path);
          missingByFingerprint.delete(hash);
        }
      }

      let relinkedCount = 0;

      for (const offlineEntry of offlineEntries) {
        const fingerprint = offlineEntry.fingerprintSha256;

        if (!fingerprint) {
          continue;
        }

        const matchingPath = matches.get(fingerprint);

        if (!matchingPath) {
          continue;
        }

        const song = await this.importSongFromPath(matchingPath);

        if (!song || song.fingerprintSha256 !== fingerprint) {
          continue;
        }

        const playlist = this.playlist();

        const entries = playlist.entries.map((item) =>
          item.id === offlineEntry.id
            ? {
                ...item,
                songId: song.id,
                fileName: song.fileName,
                fingerprintSha256: song.fingerprintSha256,
                sourcePath: song.sourcePath,
                offline: false
              }
            : item
        );

        this.playlist.set({
          ...playlist,
          entries
        });

        relinkedCount++;
      }

      const remainingOffline = this.playlist().entries.filter((item) => item.offline);

      if (!remainingOffline.length) {
        this.closeRecoveryDialog();
        this.status.set(`Relinked ${relinkedCount} missing song${relinkedCount === 1 ? '' : 's'}.`);
        return;
      }

      this.status.set(`Relinked ${relinkedCount}. ${remainingOffline.length} song${remainingOffline.length === 1 ? '' : 's'} still missing.`);

      this.showNextOfflineSongDialog();
    } catch (error) {
      this.recoveryDialog.set({
        title: 'Folder search failed',
        message: this.errorMessage(error),
        entry,
        kind: 'info'
      });

      this.status.set(`Folder search failed: ${this.errorMessage(error)}`);
    }
  }

  setPlaylistPauseEnabled(enabled: boolean): void {
    const playlist = this.playlist();

    this.playlist.set({
      ...playlist,
      pauseBetweenSongsEnabled: enabled
    });
  }

  setEntryPauseAfterEnabled(entryId: string, enabled: boolean): void {
    const playlist = this.playlist();

    const entries = playlist.entries.map((entry) =>
      entry.id === entryId
        ? {
            ...entry,
            pauseAfterEnabled: enabled
          }
        : entry
    );

    this.playlist.set({
      ...playlist,
      entries
    });
  }

  setPlaylistPauseSeconds(value: number): void {
    if (!Number.isFinite(value)) {
      return;
    }

    const seconds = Math.max(0, Math.min(300, Math.round(value)));

    const playlist = this.playlist();

    this.playlist.set({
      ...playlist,
      pauseBetweenSongsSeconds: seconds
    });
  }

  effectivePauseEnabled(entry: PlaylistEntry): boolean {
    return this.playlist().pauseBetweenSongsEnabled && (entry.pauseAfterEnabled ?? true);
  }

  effectivePauseSeconds(entry: PlaylistEntry): number {
    return entry.pauseAfterSeconds ?? this.playlist().pauseBetweenSongsSeconds;
  }

  effectiveCountInEnabled(entry: PlaylistEntry, song: Song): boolean {
    return entry.countInEnabled ?? song.countInEnabled;
  }

  effectiveCountInClicks(entry: PlaylistEntry, song: Song): number {
    return entry.countInClicks ?? song.countInClicks;
  }

  private async ensureSongDuration(song: Song): Promise<number | null> {
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

  private chordDisplayTime(song: Song, actualTime: number): number {
    if (!song.beats.length || this.chordDisplayLeadBeats <= 0) {
      return actualTime;
    }

    let beatDuration = 60 / (this.effectiveBpm(song) ?? song.bpm ?? 120);

    for (let i = 0; i < song.beats.length - 1; i++) {
      const currentBeat = song.beats[i];
      const nextBeat = song.beats[i + 1];

      if (actualTime >= currentBeat.timestampSeconds && actualTime < nextBeat.timestampSeconds) {
        const measuredDuration = nextBeat.timestampSeconds - currentBeat.timestampSeconds;

        if (Number.isFinite(measuredDuration) && measuredDuration > 0) {
          beatDuration = measuredDuration;
        }

        break;
      }
    }

    return actualTime + beatDuration * this.chordDisplayLeadBeats;
  }

  showMissingSongDialog(entry: PlaylistEntry): void {
    this.recoveryDialog.set({
      title: 'Audio file not found',
      message: `${entry.fileName ?? 'This song'} could not be found at its saved location.`,
      entry,
      kind: 'missing'
    });
  }

  showInvalidSongDialog(entry: PlaylistEntry): void {
    this.recoveryDialog.set({
      title: 'Wrong audio file',
      message: `The selected file does not match ${entry.fileName ?? 'the missing song'}.`,
      entry,
      kind: 'invalid'
    });
  }

  closeRecoveryDialog(): void {
    this.recoveryDialog.set(null);
  }

  private showNextOfflineSongDialog(): void {
    const nextOfflineEntry = this.playlist().entries.find((entry) => entry.offline);

    if (!nextOfflineEntry) {
      this.closeRecoveryDialog();
      return;
    }

    this.showMissingSongDialog(nextOfflineEntry);
  }

  setLoopSection(sectionId: string | null): void {
    const song = this.selectedSong();

    if (!song) {
      return;
    }

    if (!sectionId) {
      this.activeLoopSectionId.set(null);
      this.status.set('Section loop disabled.');
      return;
    }

    const section = song.sections.find((item) => item.id === sectionId);

    if (!section) {
      return;
    }

    this.activeLoopSectionId.set(section.id);

    this.currentTime.set(section.startSeconds);

    this.dsp.seek(section.startSeconds, this.practiceSpeed() / 100, this.effectiveDspShift(song));

    this.status.set(`Loop section: ${section.label}`);
  }

  private midiEventBytes(event: MidiEvent): number[] | null {
    const channel = Math.max(1, Math.min(16, event.channel)) - 1;

    if (event.kind === 'program-change') {
      return [0xc0 | channel, Math.max(0, Math.min(127, event.data1))];
    }

    if (event.kind === 'control-change') {
      return [0xb0 | channel, Math.max(0, Math.min(127, event.data1)), Math.max(0, Math.min(127, event.data2 ?? 0))];
    }

    if (event.kind === 'raw') {
      return event.rawBytes?.length ? [...event.rawBytes] : null;
    }

    return null;
  }

  private async sendScheduledMidiEvent(event: MidiEvent): Promise<void> {
    const device = event.deviceName || this.activeMidiDevice();

    if (!device) {
      console.warn('Scheduled MIDI event skipped: no MIDI output selected.', event);
      return;
    }

    const bytes = this.midiEventBytes(event);

    if (!bytes?.length) {
      console.warn('Scheduled MIDI event skipped: invalid MIDI payload.', event);
      return;
    }

    try {
      await this.backend.sendMidiBytes(device, bytes);

      console.log('Scheduled MIDI sent:', {
        id: event.id,
        label: event.label,
        device,
        kind: event.kind,
        bytes
      });
    } catch (error) {
      console.error('Scheduled MIDI send failed:', {
        event,
        error
      });

      this.status.set(`MIDI send failed: ${this.errorMessage(error)}`);
    }
  }

  midiDeviceTimingMs(deviceName: string): number {
    if (!deviceName) {
      return 0;
    }

    return this.midiDeviceTimingCompensation()[deviceName] ?? 0;
  }

  setMidiDeviceTimingMs(deviceName: string, value: number): void {
    if (!deviceName) {
      return;
    }

    const timingMs = Number.isFinite(value) ? Math.round(value) : 0;

    this.midiDeviceTimingCompensation.update((current) => ({
      ...current,
      [deviceName]: timingMs
    }));

    void this.saveGlobalSettings();
  }

  midiEventsForChord(chordId: string): MidiEvent[] {
    const song = this.selectedSong();

    if (!song) {
      return [];
    }

    return song.midiEvents.filter((event) => event.anchorChordId === chordId);
  }

  midiSummaryForChord(chordId: string): string | null {
    const events = this.midiEventsForChord(chordId);

    if (!events.length) {
      return null;
    }

    if (events.length === 1) {
      const event = events[0];

      return event.label || (event.kind === 'program-change' ? `Program ${event.data1}` : `CC ${event.data1}`);
    }

    return `${events.length} MIDI events`;
  }

  private resetLiveMidiScheduler(song: Song, timeSeconds: number): void {
    this.liveMidiFiredEventIds.clear();
    this.liveMidiLastTime = timeSeconds;

    for (const event of song.midiEvents) {
      const beat = song.beats.find((item) => item.id === event.anchorBeatId);

      if (!beat) {
        continue;
      }

      const deviceName = event.deviceName || this.activeMidiDevice();
      const deviceTimingMs = this.midiDeviceTimingMs(deviceName);

      const triggerTime = beat.timestampSeconds + (event.offsetMs + deviceTimingMs) / 1000;

      if (triggerTime < timeSeconds - 0.02) {
        this.liveMidiFiredEventIds.add(event.id);
      }
    }
  }

  private processLiveMidiScheduler(song: Song, timeSeconds: number): void {
    const previousTime = this.liveMidiLastTime;

    if (timeSeconds < previousTime - 0.1) {
      this.resetLiveMidiScheduler(song, timeSeconds);
      return;
    }

    for (const event of song.midiEvents) {
      if (this.liveMidiFiredEventIds.has(event.id)) {
        continue;
      }

      const beat = song.beats.find((item) => item.id === event.anchorBeatId);

      if (!beat) {
        continue;
      }

      const deviceName = event.deviceName || this.activeMidiDevice();
      const deviceTimingMs = this.midiDeviceTimingMs(deviceName);

      const triggerTime = beat.timestampSeconds + (event.offsetMs + deviceTimingMs) / 1000;

      if (timeSeconds >= triggerTime) {
        this.liveMidiFiredEventIds.add(event.id);

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

    this.liveMidiLastTime = timeSeconds;
  }

  private scrollActiveLivePlaylistIntoView(): void {
    requestAnimationFrame(() => {
      const container = this.livePlaylistRef?.nativeElement;
      const entryId = this.liveActiveEntryId();

      if (!container || !entryId) {
        return;
      }

      const row = Array.from(container.querySelectorAll<HTMLElement>('.live-playlist-row')).find((item) => item.dataset['liveEntryId'] === entryId);

      if (!row) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();

      const padding = 8;

      if (rowRect.top < containerRect.top + padding) {
        container.scrollTo({
          top: container.scrollTop - (containerRect.top + padding - rowRect.top),
          behavior: 'smooth'
        });

        return;
      }

      if (rowRect.bottom > containerRect.bottom - padding) {
        container.scrollTo({
          top: container.scrollTop + (rowRect.bottom - (containerRect.bottom - padding)),
          behavior: 'smooth'
        });
      }
    });
  }

  applyPastedMidiEvent(): void {
    const text = this.midiPasteInput().trim();

    if (!text) {
      this.midiPasteError.set('Paste a MIDI event first.');
      return;
    }

    try {
      const parsed = JSON.parse(text) as {
        kind?: MidiMessageKind;
        channel?: number;
        data1?: number;
        data2?: number;
        rawBytes?: number[];
      };

      if (parsed.kind !== 'program-change' && parsed.kind !== 'control-change' && parsed.kind !== 'raw') {
        throw new Error('Unsupported MIDI event kind.');
      }

      const channel = Number(parsed.channel);

      if (!Number.isFinite(channel) || channel < 1 || channel > 16) {
        throw new Error('Channel must be between 1 and 16.');
      }

      this.midiEventKindInput.set(parsed.kind);
      this.midiEventChannelInput.set(channel);

      if (parsed.kind === 'program-change') {
        this.midiEventData1Input.set(Math.max(0, Math.min(127, Number(parsed.data1 ?? 0))));

        this.midiEventData2Input.set(0);
      }

      if (parsed.kind === 'control-change') {
        this.midiEventData1Input.set(Math.max(0, Math.min(127, Number(parsed.data1 ?? 0))));

        this.midiEventData2Input.set(Math.max(0, Math.min(127, Number(parsed.data2 ?? 0))));
      }

      if (parsed.kind === 'raw') {
        if (!Array.isArray(parsed.rawBytes) || !parsed.rawBytes.length) {
          throw new Error('Raw MIDI requires rawBytes.');
        }

        this.midiEventRawBytesInput.set(parsed.rawBytes.map((value) => Math.max(0, Math.min(255, Math.round(Number(value))))));
      }

      this.midiPasteError.set('');
      this.status.set('Pasted MIDI event applied.');
    } catch (error) {
      this.midiPasteError.set(error instanceof Error ? error.message : 'Invalid MIDI event.');
    }
  }

  private async saveGlobalSettings(): Promise<void> {
    try {
      await this.settings.save({
        schemaVersion: 1,

        midi: {
          outputDevice: this.activeMidiDevice(),
          inputDevice: this.activeMidiInputDevice(),
          deviceTimingCompensationMs: {
            ...this.midiDeviceTimingCompensation()
          }
        },

        live: {
          loudnessMatchingEnabled: this.liveLoudnessMatchingEnabled()
        }
      });
    } catch (error) {
      console.error('Could not save global settings:', error);
      this.status.set(`Could not save settings: ${this.errorMessage(error)}`);
    }
  }

  setActiveMidiDevice(deviceName: string): void {
    this.activeMidiDevice.set(deviceName);
    void this.saveGlobalSettings();
  }

  setActiveMidiInputDevice(deviceName: string): void {
    this.activeMidiInputDevice.set(deviceName);
    void this.saveGlobalSettings();
  }

  setLiveLoudnessMatchingEnabled(enabled: boolean): void {
    this.liveLoudnessMatchingEnabled.set(enabled);

    const song = this.liveCurrentSong();

    if (song) {
      const gainDb = enabled ? (this.liveLoudnessGainDb(song) ?? 0) : 0;

      this.dsp.setOutputGainDb(gainDb);
    }

    void this.saveGlobalSettings();
  }

  openShortcutHelp(): void {
    this.shortcutHelpOpen.set(true);
  }

  closeShortcutHelp(): void {
    this.shortcutHelpOpen.set(false);
  }

  //-------------------------------------- TESTING functions ---------------------------------------------
  testEssentiaWorker(): void {
    const worker = new Worker(new URL('./workers/essentia.worker', import.meta.url), { type: 'module' });

    worker.onmessage = ({ data }) => {
      console.log('Essentia worker:', data);

      this.status.set(`Essentia worker - RhythmExtractor2013: ${data.hasRhythmExtractor2013 ? 'ready' : 'missing'}`);

      worker.terminate();
    };

    worker.onerror = (error) => {
      console.error('Essentia worker error:', error);
      this.status.set(`Essentia worker error: ${error.message}`);
      worker.terminate();
    };

    worker.postMessage({ type: 'ping' });
  }

  async testChordPreview(): Promise<void> {
    const song = this.selectedSong();

    if (!song?.assetUrl) {
      this.status.set('No song selected.');
      return;
    }

    if (song.beats.length < 2) {
      this.status.set('Analyze rhythm first.');
      return;
    }

    try {
      this.isAnalyzing.set(true);
      this.status.set('Analyzing chords on detected beats...');

      const response = await fetch(song.assetUrl);
      const arrayBuffer = await response.arrayBuffer();

      const audioContext = new AudioContext({
        sampleRate: 44100
      });

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      const mono = new Float32Array(audioBuffer.length);

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);

        for (let i = 0; i < channelData.length; i++) {
          mono[i] += channelData[i] / audioBuffer.numberOfChannels;
        }
      }

      await audioContext.close();

      const worker = new Worker(new URL('./workers/essentia.worker', import.meta.url), { type: 'module' });

      worker.onmessage = ({ data }) => {
        if (data.type === 'chords-beats-result') {
          console.table(data.chords);

          const chords: ChordEvent[] = data.chords
            .map((result: { beatIndex: number; timestampSeconds: number; chord: string; strength: number; spanBeats?: number }) => {
              const beatIndex = result.beatIndex;
              const beat = song.beats[beatIndex];

              if (!beat) return null;

              return {
                id: `chord-${beatIndex}`,
                beatId: beat.id,
                beatIndex,
                canonicalChord: result.chord,
                spanBeats: result.spanBeats ?? 1
              } satisfies ChordEvent;
            })
            .filter((chord: ChordEvent | null): chord is ChordEvent => chord !== null);

          this.library.update(song.id, {
            chords
          });

          this.status.set(`Chord preview loaded: ${chords.length} beat-aligned chords`);

          this.isAnalyzing.set(false);
          worker.terminate();
        }

        if (data.type === 'error') {
          console.error(data.message);

          this.status.set(`Chord analysis error: ${data.message}`);

          this.isAnalyzing.set(false);
          worker.terminate();
        }
      };

      worker.onerror = (error) => {
        console.error(error);

        this.status.set(`Chord worker error: ${error.message}`);

        this.isAnalyzing.set(false);
        worker.terminate();
      };

      worker.postMessage(
        {
          type: 'analyze-chords-beats',
          samples: mono.buffer,
          ticks: song.beats.map((beat) => beat.timestampSeconds)
        },
        [mono.buffer]
      );
    } catch (error) {
      this.isAnalyzing.set(false);

      this.status.set(`Chord analysis error: ${this.errorMessage(error)}`);
    }
  }

  async testTuningDetection(song: Song): Promise<void> {
    if (!song.assetUrl) {
      this.status.set('Song has no audio source.');
      return;
    }

    try {
      this.status.set('Detecting tuning...');

      const response = await fetch(song.assetUrl);
      const arrayBuffer = await response.arrayBuffer();

      const audioContext = new AudioContext({
        sampleRate: 44100
      });

      const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));

      const mono = new Float32Array(audioBuffer.length);

      for (let channel = 0; channel < audioBuffer.numberOfChannels; channel++) {
        const channelData = audioBuffer.getChannelData(channel);

        for (let i = 0; i < channelData.length; i++) {
          mono[i] += channelData[i] / audioBuffer.numberOfChannels;
        }
      }

      await audioContext.close();

      const worker = new Worker(new URL('./workers/essentia.worker', import.meta.url), { type: 'module' });

      worker.onmessage = ({ data }) => {
        if (data.type === 'tuning-result') {
          this.status.set(`Detected tuning: ${data.tuningFrequency.toFixed(1)} Hz (${data.tuningCents.toFixed(1)} cents)`);

          console.log('Tuning result:', data);

          worker.terminate();
        }

        if (data.type === 'error') {
          this.status.set(`Tuning error: ${data.message}`);

          worker.terminate();
        }
      };

      worker.onerror = (error) => {
        this.status.set(`Tuning error: ${error.message}`);

        worker.terminate();
      };

      worker.postMessage(
        {
          type: 'analyze-tuning',
          samples: mono.buffer
        },
        [mono.buffer]
      );
    } catch (error) {
      this.status.set(`Tuning error: ${this.errorMessage(error)}`);
    }
  }

  testSyntheticTuning(frequency = 432): void {
    const sampleRate = 44100;
    const durationSeconds = 10;
    const length = sampleRate * durationSeconds;

    const samples = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;

      // Fundamental + a few harmonics so it behaves more like
      // a musical tone than a perfect sine wave.
      samples[i] = 0.6 * Math.sin(2 * Math.PI * frequency * t) + 0.25 * Math.sin(2 * Math.PI * frequency * 2 * t) + 0.1 * Math.sin(2 * Math.PI * frequency * 3 * t);
    }

    const worker = new Worker(new URL('./workers/essentia.worker', import.meta.url), { type: 'module' });

    worker.onmessage = ({ data }) => {
      console.log(`Synthetic ${frequency} Hz test:`, data);

      worker.terminate();
    };

    worker.postMessage({
      type: 'analyze-tuning',
      samples: samples.buffer
    });
  }

  addTestPracticeMidiEvent(): void {
    const song = this.selectedSong();

    if (!song || !song.beats.length) {
      this.status.set('Need an analyzed song with beats.');
      return;
    }

    const startSeconds = this.songStartSeconds(song);
    const endSeconds = this.songEndSeconds(song);

    const beat = song.beats.find((item) => item.timestampSeconds >= startSeconds + 2 && item.timestampSeconds < endSeconds);

    if (!beat) {
      this.status.set('Could not find a beat after the song start point.');
      return;
    }

    const event: MidiEvent = {
      id: `test-midi-${Date.now()}`,
      anchorBeatId: beat.id,
      offsetMs: -100,
      deviceName: this.activeMidiDevice() || undefined,
      kind: 'program-change',
      channel: 1,
      data1: 12,
      label: 'TEST PATCH'
    };

    this.library.update(song.id, {
      midiEvents: [...song.midiEvents, event]
    });

    this.status.set(`Test MIDI event added at beat ${beat.index + 1} (${this.formatTime(beat.timestampSeconds)})`);

    console.log('Test MIDI event added:', {
      event,
      beatTime: beat.timestampSeconds,
      expectedTriggerTime: beat.timestampSeconds - 0.1
    });
  }

  // ---------------------------------------------------------
}
