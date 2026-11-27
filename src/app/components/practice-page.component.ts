import { CommonModule } from '@angular/common';
import { Component, ElementRef, HostListener, ViewChild, effect, inject, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChordEvent, MidiEvent, MidiMessageKind, Song, SongSection } from '../models/domain.models';
import { AnalysisOrchestratorService } from '../services/analysis-orchestrator.service';
import { ApplicationStateService } from '../services/application-state.service';
import { DspService } from '../services/dsp.service';
import { LibraryService } from '../services/library.service';
import { MidiDeviceService } from '../services/midi-device.service';
import { PracticePlaybackService } from '../services/practice-playback.service';
import { PracticeStateService } from '../services/practice-state.service';
import { RegionalAnalysisMode, RegionalAnalysisService } from '../services/regional-analysis.service';
import { SidecarService } from '../services/sidecar.service';
import { clampTranspose, displaySongKey, formatTime, inverseTransposeChord, transposeChord } from '../utils/music.util';
import { formatMidiBytes } from '../utils/midi.util';

@Component({
  selector: 'app-practice-page',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './practice-page.component.html',
  styleUrl: './practice-page.component.css'
})
export class PracticePageComponent {
  @ViewChild('audio') audioRef?: ElementRef<HTMLAudioElement>;

  readonly Math = Math;
  private readonly practiceState = inject(PracticeStateService);
  private readonly library = inject(LibraryService);
  private readonly sidecars = inject(SidecarService);
  private readonly dsp = inject(DspService);
  private readonly appState = inject(ApplicationStateService);
  private readonly midiDevices = inject(MidiDeviceService);
  private readonly analysisOrchestrator = inject(AnalysisOrchestratorService);
  private readonly playback = inject(PracticePlaybackService);
  private readonly regionalAnalysis = inject(RegionalAnalysisService);

  readonly tab = this.appState.tab;
  readonly status = this.appState.status;
  readonly sectionColors = this.practiceState.sectionColors;
  readonly selectedSong = this.practiceState.selectedSong;
  readonly displayedChords = this.practiceState.displayedChords;
  readonly currentChord = this.practiceState.currentChord;
  readonly nextChord = this.practiceState.nextChord;
  readonly currentTime = this.practiceState.currentTime;
  readonly isPlaying = this.practiceState.isPlaying;
  readonly countInClicks = this.practiceState.countInClicks;
  readonly countInEnabled = this.practiceState.countInEnabled;
  readonly countInEditing = this.practiceState.countInEditing;
  readonly countInEditValue = this.practiceState.countInEditValue;
  readonly practiceSpeed = this.practiceState.practiceSpeed;
  readonly formantCompensationEnabled = this.practiceState.formantCompensationEnabled;
  readonly selectedChordId = this.practiceState.selectedChordId;
  readonly chordEditValue = this.practiceState.chordEditValue;
  readonly chordEditInvalid = this.practiceState.chordEditInvalid;
  readonly chordContextMenu = this.practiceState.chordContextMenu;
  readonly isWaveformScrubbing = this.practiceState.isWaveformScrubbing;
  readonly waveformContextMenu = this.practiceState.waveformContextMenu;
  readonly waveformMenuPage = this.practiceState.waveformMenuPage;
  readonly sectionCreateDialog = this.practiceState.sectionCreateDialog;
  readonly sectionEditDialog = this.practiceState.sectionEditDialog;
  readonly sectionNameInput = this.practiceState.sectionNameInput;
  readonly sectionColorInput = this.practiceState.sectionColorInput;
  readonly pendingSection = this.practiceState.pendingSection;
  readonly isCountingIn = this.practiceState.isCountingIn;
  readonly canUseCountIn = this.practiceState.canUseCountIn;
  readonly activeLoopSectionId = this.practiceState.activeLoopSectionId;
  readonly activeLoopSection = this.practiceState.activeLoopSection;
  readonly loopCountInEnabled = this.practiceState.loopCountInEnabled;
  readonly midiEventDialog = this.practiceState.midiEventDialog;
  readonly midiEventKindInput = this.practiceState.midiEventKindInput;
  readonly midiEventChannelInput = this.practiceState.midiEventChannelInput;
  readonly midiEventData1Input = this.practiceState.midiEventData1Input;
  readonly midiEventData2Input = this.practiceState.midiEventData2Input;
  readonly midiEventRawBytesInput = this.practiceState.midiEventRawBytesInput;
  readonly midiEventOffsetInput = this.practiceState.midiEventOffsetInput;
  readonly midiEventLabelInput = this.practiceState.midiEventLabelInput;
  readonly midiEventDeviceInput = this.practiceState.midiEventDeviceInput;
  readonly midiPasteInput = this.practiceState.midiPasteInput;
  readonly midiPasteError = this.practiceState.midiPasteError;
  readonly midiOutputs = this.midiDevices.midiOutputs;
  readonly activeMidiDevice = this.midiDevices.activeMidiDevice;
  readonly isAnalyzing = this.analysisOrchestrator.isAnalyzing;
  readonly sourceTuningInput = this.analysisOrchestrator.sourceTuningInput;
  readonly tuningChoicePrompt = this.analysisOrchestrator.tuningChoicePrompt;
  readonly manualChordAnalysisConfirmation = this.analysisOrchestrator.manualChordAnalysisConfirmation;
  readonly regionalAnalysisDialog = this.regionalAnalysis.dialog;
  readonly regionalAnalysisStartInput = this.regionalAnalysis.startInput;
  readonly regionalAnalysisEndInput = this.regionalAnalysis.endInput;
  readonly regionalAnalysisRegion = this.regionalAnalysis.selectedRegion;
  readonly isRegionalAnalysisAnalyzing = this.regionalAnalysis.isAnalyzing;
  readonly dspAudioReady = this.playback.dspAudioReady;
  readonly chordWidthPx = 90;
  readonly formatTime = formatTime;
  readonly displaySongKey = displaySongKey;
  readonly formatMidiBytes = formatMidiBytes;

  private chordClickTimer: number | null = null;

  private readonly loadAudioEffect = effect(() => {
    const songId = this.library.selectedSongId();
    const isPracticeTab = this.tab() === 'practice';

    if (!songId || !isPracticeTab) {
      return;
    }

    const song = untracked(() => this.library.selectedSong());

    if (!song?.assetUrl) {
      return;
    }

    setTimeout(() => {
      if (this.library.selectedSongId() !== songId || this.tab() !== 'practice') {
        return;
      }

      this.loadAudio(song);
      void this.playback.loadDspAudio(song);
    }, 0);
  });

  // Playback controls and analysis actions
  loadAudio(song = this.selectedSong()): void {
    const audio = this.audioRef?.nativeElement;

    if (audio && song?.assetUrl) {
      audio.pause();
      audio.src = song.assetUrl;
      audio.currentTime = 0;
      audio.load();
    }
  }

  async togglePlay(): Promise<void> { await this.playback.togglePlay(); }
  stopPlayback(): void { this.playback.stopPlayback(); }
  async restartPlayback(): Promise<void> { await this.playback.restartPlayback(); }
  setSpeed(value: number): void { this.playback.setSpeed(value); }
  effectiveBpm(song: Song): number | null { return this.playback.effectiveBpm(song); }
  setLoopSection(sectionId: string | null): void { this.playback.setLoopSection(sectionId); }
  seekByBeat(direction: -1 | 1): void { this.playback.seekByBeat(direction); }
  analyzeSong(song: Song): void { this.analysisOrchestrator.requestFullAnalysis(song); }
  confirmFullAnalysis(): void { this.analysisOrchestrator.confirmFullAnalysis(); }
  cancelFullAnalysis(): void { this.analysisOrchestrator.cancelFullAnalysis(); }
  openRegionalAnalysisDialog(): void {
    const song = this.selectedSong();
    if (!song) return;
    this.regionalAnalysis.openDialog(song, this.currentTime());
    this.closeWaveformContextMenu();
  }
  closeRegionalAnalysisDialog(): void { this.regionalAnalysis.closeDialog(); }
  setRegionalStart(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.regionalAnalysisStartInput.set(value);
  }
  setRegionalEnd(event: Event): void {
    const value = Number((event.target as HTMLInputElement).value);
    this.regionalAnalysisEndInput.set(value);
  }
  async runRegionalAnalysis(mode: RegionalAnalysisMode): Promise<void> {
    await this.regionalAnalysis.analyze(mode);
  }
  cancelRegionalAnalysis(): void { this.regionalAnalysis.cancelAnalysis(); }
  async saveSidecar(): Promise<void> { await this.analysisOrchestrator.saveSidecar(); }
  applyTuningCorrection(): void { this.analysisOrchestrator.applyTuningCorrection(); }
  resetTuning(): void { this.analysisOrchestrator.resetTuning(); }
  keepOriginalTuning(): void { this.analysisOrchestrator.keepOriginalTuning(); }
  tuneTo440(): void { this.analysisOrchestrator.tuneTo440(); }
  onSourceTuningChange(event: Event): void { this.analysisOrchestrator.onSourceTuningChange(event); }
  sourceTuningIsValid(): boolean { return this.analysisOrchestrator.sourceTuningIsValid(); }
  sourceTuningError(): string { return this.analysisOrchestrator.sourceTuningError(); }

  private recalculateSongLoudness(song: Song): void {
    void this.analysisOrchestrator.recalculateSongLoudness(song);
  }

  private effectiveDspShift(song: Song): number { return this.playback.effectiveDspShift(song); }
  // Audio element events and song settings
  onAudioTime(): void {
    const audio = this.audioRef?.nativeElement;
    if (audio) this.currentTime.set(audio.currentTime);
  }

  onMetadata(): void {
    const audio = this.audioRef?.nativeElement;
    const song = this.selectedSong();
    if (audio && song && Number.isFinite(audio.duration)) this.library.update(song.id, { durationSeconds: audio.duration });
  }

  @HostListener('document:click')
  closeOpenTransientUi(): void {
    this.closeChordContextMenu();
    this.closeWaveformContextMenu();
  }

  onAudioPlay(): void {
    this.playback.onAudioPlay();
  }

  onAudioPause(): void {
    this.playback.onAudioPause();
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
    this.playback.setFormantCompensation(input.checked);
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

  // Chord selection and editing
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

  // Timeline presentation
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

  // Waveform seeking and song boundaries
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

    void this.analysisOrchestrator.recalculateSongLoudness(updatedSong);
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

  // Named section editing
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

  // Count-in and MIDI display helpers
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
  private chordDisplayTime(song: Song, actualTime: number): number {
    if (!song.beats.length || this.chordDisplayLeadBeats <= 0) return actualTime;
    let beatDuration = 60 / (this.effectiveBpm(song) ?? song.bpm ?? 120);
    for (let i = 0; i < song.beats.length - 1; i++) {
      const currentBeat = song.beats[i];
      const nextBeat = song.beats[i + 1];
      if (actualTime >= currentBeat.timestampSeconds && actualTime < nextBeat.timestampSeconds) {
        const measuredDuration = nextBeat.timestampSeconds - currentBeat.timestampSeconds;
        if (Number.isFinite(measuredDuration) && measuredDuration > 0) beatDuration = measuredDuration;
        break;
      }
    }
    return actualTime + beatDuration * this.chordDisplayLeadBeats;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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

  readonly chordDisplayLeadBeats = 0;
}
