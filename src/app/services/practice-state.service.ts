import { Injectable, computed, inject, signal } from '@angular/core';
import { ChordEvent, MidiEvent, MidiMessageKind, Song } from '../models/domain.models';
import { transposeChord } from '../utils/music.util';
import { LibraryService } from './library.service';

@Injectable({ providedIn: 'root' })
export class PracticeStateService {
  private readonly library = inject(LibraryService);

  readonly sectionColors = ['#e05252', '#e28a3b', '#d9b83e', '#62b85c', '#39a8a1', '#4f8cff', '#796bd8', '#b85fb4'];
  // Playback state
  readonly countInClicks = signal(4);
  readonly countInEnabled = signal(false);
  readonly countInEditing = signal(false);
  readonly countInEditValue = signal('3');
  readonly practiceSpeed = signal(100);
  readonly formantCompensationEnabled = signal(false);
  readonly currentTime = signal(0);
  readonly isPlaying = signal(false);
  readonly selectedSong = this.library.selectedSong;

  // Chord display and editing state
  readonly displayedChords = computed(() => {
    const song = this.selectedSong();
    return song?.chords.map((chord) => ({ ...chord, displayed: transposeChord(chord.canonicalChord, song.transposeSemitones) })) ?? [];
  });
  readonly currentChordIndex = computed(() => {
    const song = this.selectedSong();

    if (!song || !song.chords.length || !song.beats.length) {
      return -1;
    }

    const time = this.currentTime();
    let activeIndex = -1;

    for (let i = 0; i < song.chords.length; i++) {
      const chord = song.chords[i];
      const beat = song.beats.find((item) => item.id === chord.beatId);

      if (!beat) {
        continue;
      }

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

      if (startBeat && startBeat.timestampSeconds <= time + 0.01) {
        return {
          ...chord,
          displayed: transposeChord(chord.canonicalChord, song.transposeSemitones)
        };
      }
    }

    const first = song.chords[0];
    return first ? { ...first, displayed: transposeChord(first.canonicalChord, song.transposeSemitones) } : null;
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
    return { ...next, displayed: transposeChord(next.canonicalChord, song.transposeSemitones) };
  });
  readonly selectedChordId = signal<string | null>(null);
  readonly chordEditValue = signal('');
  readonly chordEditInvalid = signal(false);
  readonly chordContextMenu = signal<{ x: number; top: number | null; bottom: number | null; chordId: string } | null>(null);

  // Waveform, sections, and loops
  readonly isWaveformScrubbing = signal(false);
  readonly waveformContextMenu = signal<{ x: number; y: number; timeSeconds: number; sectionId: string | null } | null>(null);
  readonly waveformMenuPage = signal<'main' | 'boundaries'>('main');
  readonly sectionCreateDialog = signal<{ startSeconds: number } | null>(null);
  readonly sectionEditDialog = signal<{ sectionId: string } | null>(null);
  readonly sectionNameInput = signal('');
  readonly sectionColorInput = signal('#4f8cff');
  readonly pendingSection = signal<{ startSeconds: number; label: string; color: string } | null>(null);
  readonly isCountingIn = signal(false);
  readonly canUseCountIn = computed(() => {
    const song = this.selectedSong();
    return !!song && song.analysisState === 'ready' && typeof song.bpm === 'number' && Number.isFinite(song.bpm) && song.bpm > 0;
  });
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

  // MIDI event editor state
  readonly midiEventDialog = signal<{ chordId: string; eventId: string | null } | null>(null);
  readonly midiEventKindInput = signal<MidiMessageKind>('program-change');
  readonly midiEventChannelInput = signal(1);
  readonly midiEventData1Input = signal(0);
  readonly midiEventData2Input = signal(127);
  readonly midiEventRawBytesInput = signal<number[]>([]);
  readonly midiEventOffsetInput = signal(0);
  readonly midiEventLabelInput = signal('');
  readonly midiEventDeviceInput = signal('');
  readonly midiPasteInput = signal('');
  readonly midiPasteError = signal('');
}
