import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit, ViewEncapsulation, inject, signal } from '@angular/core';
import { BackendService } from './services/backend.service';
import { LibraryService } from './services/library.service';
import { MidiEvent, Song } from './models/domain.models';
import { formatTime } from './utils/music.util';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { DspService } from './services/dsp.service';
import { MidiPageComponent } from './components/midi-page.component';
import { SettingsPageComponent } from './components/settings-page.component';
import { ApplicationStateService, AppTab } from './services/application-state.service';
import { MidiDeviceService } from './services/midi-device.service';
import { PracticeStateService } from './services/practice-state.service';
import { LiveStateService } from './services/live-state.service';
import { LivePlaybackService } from './services/live-playback.service';
import { PracticePlaybackService } from './services/practice-playback.service';
import { PracticePageComponent } from './components/practice-page.component';
import { LibraryPageComponent } from './components/library-page.component';
import { LibraryImportService } from './services/library-import.service';
import { LivePlaylistService } from './services/live-playlist.service';
import { LivePageComponent } from './components/live-page.component';

type Tab = AppTab;

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, LibraryPageComponent, LivePageComponent, MidiPageComponent, PracticePageComponent, SettingsPageComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
  encapsulation: ViewEncapsulation.None
})
export class AppComponent implements OnInit {
  readonly backend = inject(BackendService);
  readonly library = inject(LibraryService);
  private readonly dsp = inject(DspService);
  private readonly applicationState = inject(ApplicationStateService);
  private readonly midiDevices = inject(MidiDeviceService);
  private readonly practiceState = inject(PracticeStateService);
  private readonly practicePlayback = inject(PracticePlaybackService);
  private readonly libraryImport = inject(LibraryImportService);
  private readonly liveState = inject(LiveStateService);
  private readonly livePlayback = inject(LivePlaybackService);
  private readonly livePlaylist = inject(LivePlaylistService);

  readonly tab = this.applicationState.tab;
  readonly status = this.applicationState.status;
  readonly health = this.applicationState.health;
  readonly midiOutputs = this.midiDevices.midiOutputs;
  readonly activeMidiDevice = this.midiDevices.activeMidiDevice;
  readonly countInClicks = this.practiceState.countInClicks;
  readonly countInEnabled = this.practiceState.countInEnabled;
  readonly practiceSpeed = this.practiceState.practiceSpeed;
  readonly currentTime = this.practiceState.currentTime;
  readonly isPlaying = this.practiceState.isPlaying;
  readonly selectedSong = this.practiceState.selectedSong;
  readonly canUseCountIn = this.practiceState.canUseCountIn;
  readonly isLibraryDragOver = signal(false);
  readonly liveCurrentSong = this.liveState.currentSong;
  readonly liveCurrentTime = this.liveState.liveCurrentTime;
  readonly midiInputs = this.midiDevices.midiInputs;
  readonly activeMidiInputDevice = this.midiDevices.activeMidiInputDevice;
  readonly liveLoudnessMatchingEnabled = this.midiDevices.liveLoudnessMatchingEnabled;
  readonly shortcutHelpOpen = signal(false);

  // ==============================
  // Application initialization
  // ==============================
  async ngOnInit(): Promise<void> {
    this.health.set(await this.backend.health());

    await this.midiDevices.initialize();

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
    await this.midiDevices.refreshDevices();
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
    return this.libraryImport.importSongFromPath(path);
  }

  // ==============================
  // Application-level controls
  // ==============================
  selectSong(song: Song): void {
    this.practicePlayback.selectSong(song);
  }

  async togglePlay(): Promise<void> {
    await this.practicePlayback.togglePlay();
  }

  stopPlayback(): void {
    this.practicePlayback.stopPlayback();
  }

  async restartPlayback(): Promise<void> {
    await this.practicePlayback.restartPlayback();
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

  private stopPlaybackClock(): void {
    this.practicePlayback.stopPlaybackClock();
  }

  setSpeed(value: number): void {
    this.practicePlayback.setSpeed(value);
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

  private cancelCountIn(): void {
    this.practicePlayback.cancelCountIn();
  }

  seekByBeat(direction: -1 | 1): void {
    this.practicePlayback.seekByBeat(direction);
  }

  // ==============================
  // Navigation and page coordination
  // ==============================
  async changeTab(nextTab: Tab): Promise<void> {
    // Leaving Practice
    if (this.tab() === 'practice' && nextTab !== 'practice') {
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
        await this.livePlayback.ensureSongDuration(song);

        this.liveCurrentTime.set(this.songStartSeconds(song));
      } catch (error) {
        console.error('Could not prepare Live song:', error);
      }
    }
  }

  async toggleLivePlayback(): Promise<void> { await this.livePlayback.toggleLivePlayback(); }
  async restartLiveCurrentSong(): Promise<void> { await this.livePlayback.restartLiveCurrentSong(); }
  seekLiveByBeat(direction: -1 | 1): void { this.livePlayback.seekLiveByBeat(direction); }
  stopLivePlayback(): void { this.livePlayback.stopLivePlayback(); }

  formatTime = formatTime;

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  // ==============================
  // Feature-service delegation
  // ==============================
  addSongToPlaylist(song: Song): void { this.livePlaylist.addSongToPlaylist(song); }

  private async openLivePlaylistFromPath(path: string): Promise<void> { await this.livePlaylist.openLivePlaylistFromPath(path); }

  midiDeviceTimingMs(deviceName: string): number {
    return this.midiDevices.midiDeviceTimingMs(deviceName);
  }

  setLiveLoudnessMatchingEnabled(enabled: boolean): void {
    this.livePlayback.setLoudnessMatchingEnabled(enabled);
  }

  // ==============================
  // Help and diagnostics
  // ==============================
  openShortcutHelp(): void {
    this.shortcutHelpOpen.set(true);
  }

  closeShortcutHelp(): void {
    this.shortcutHelpOpen.set(false);
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

}
