import { CommonModule } from '@angular/common';
import { CdkDragDrop, DragDropModule } from '@angular/cdk/drag-drop';
import { Component, ElementRef, ViewChild, effect, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ChordEvent, MidiEvent, PlaylistEntry, Song } from '../models/domain.models';
import { ApplicationStateService } from '../services/application-state.service';
import { LivePlaybackService } from '../services/live-playback.service';
import { LivePlaylistService } from '../services/live-playlist.service';
import { LiveStateService } from '../services/live-state.service';
import { MidiDeviceService } from '../services/midi-device.service';
import { PracticePlaybackService } from '../services/practice-playback.service';
import { displaySongKey, transposeChord } from '../utils/music.util';

@Component({
  selector: 'app-live-page',
  standalone: true,
  imports: [CommonModule, FormsModule, DragDropModule],
  templateUrl: './live-page.component.html',
  styleUrl: './live-page.component.css'
})
export class LivePageComponent {
  @ViewChild('livePlaylist') private livePlaylistRef?: ElementRef<HTMLDivElement>;

  private readonly applicationState = inject(ApplicationStateService);
  private readonly liveState = inject(LiveStateService);
  private readonly livePlayback = inject(LivePlaybackService);
  private readonly livePlaylist = inject(LivePlaylistService);
  private readonly practicePlayback = inject(PracticePlaybackService);
  private readonly midiDevices = inject(MidiDeviceService);

  readonly displaySongKey = displaySongKey;
  readonly tab = this.applicationState.tab;
  readonly playlist = this.liveState.playlist;
  readonly playlistSongs = this.liveState.playlistSongs;
  readonly liveCurrentSong = this.liveState.currentSong;
  readonly liveNextSong = this.liveState.nextSong;
  readonly livePlaybackState = this.liveState.livePlaybackState;
  readonly liveCurrentTime = this.liveState.liveCurrentTime;
  readonly liveCountdownSeconds = this.liveState.liveCountdownSeconds;
  readonly liveActiveEntryId = this.liveState.liveActiveEntryId;
  readonly liveLoudnessTargetLufs = this.liveState.loudnessTargetLufs;
  readonly liveLoudnessMatchingEnabled = this.midiDevices.liveLoudnessMatchingEnabled;
  readonly recoveryDialog = this.liveState.recoveryDialog;
  readonly chordWidthPx = 90;
  readonly chordDisplayLeadBeats = 0;

  private readonly activeEntryScrollEffect = effect(() => {
    this.liveActiveEntryId();
    this.scrollActiveLivePlaylistIntoView();
  });

  async startLivePlaylist(): Promise<void> { await this.livePlayback.startLivePlaylist(); }
  async startLivePlaylistFrom(index: number): Promise<void> { await this.livePlayback.startLivePlaylistFrom(index); }
  async toggleLivePlayback(): Promise<void> { await this.livePlayback.toggleLivePlayback(); }
  async restartLiveCurrentSong(): Promise<void> { await this.livePlayback.restartLiveCurrentSong(); }
  seekLiveByBeat(direction: -1 | 1): void { this.livePlayback.seekLiveByBeat(direction); }
  stopLivePlayback(): void { this.livePlayback.stopLivePlayback(); }
  async saveLivePlaylist(): Promise<void> { await this.livePlaylist.saveLivePlaylist(); }
  async openLivePlaylist(): Promise<void> { await this.livePlaylist.openLivePlaylist(); }
  addSongToPlaylist(song: Song): void { this.livePlaylist.addSongToPlaylist(song); }
  reorderPlaylist(event: CdkDragDrop<PlaylistEntry[]>): void { this.livePlaylist.reorderPlaylist(event); }
  removeSongFromPlaylist(entryId: string): void { this.livePlaylist.removeSongFromPlaylist(entryId); }
  async locateOfflinePlaylistSong(entry: PlaylistEntry): Promise<void> { await this.livePlaylist.locateOfflinePlaylistSong(entry); }
  async searchFolderForOfflineSong(entry: PlaylistEntry): Promise<void> { await this.livePlaylist.searchFolderForOfflineSong(entry); }
  closeRecoveryDialog(): void { this.livePlaylist.closeRecoveryDialog(); }
  setPlaylistPauseEnabled(enabled: boolean): void { this.livePlaylist.setPlaylistPauseEnabled(enabled); }
  setEntryPauseAfterEnabled(entryId: string, enabled: boolean): void { this.livePlaylist.setEntryPauseAfterEnabled(entryId, enabled); }
  setPlaylistPauseSeconds(value: number): void { this.livePlaylist.setPlaylistPauseSeconds(value); }
  effectivePauseEnabled(entry: PlaylistEntry): boolean { return this.livePlaylist.effectivePauseEnabled(entry); }
  effectivePauseSeconds(entry: PlaylistEntry): number { return this.livePlaylist.effectivePauseSeconds(entry); }
  effectiveCountInEnabled(entry: PlaylistEntry, song: Song): boolean { return this.livePlaylist.effectiveCountInEnabled(entry, song); }
  effectiveCountInClicks(entry: PlaylistEntry, song: Song): number { return this.livePlaylist.effectiveCountInClicks(entry, song); }
  setLiveLoudnessMatchingEnabled(enabled: boolean): void { this.livePlayback.setLoudnessMatchingEnabled(enabled); }
  selectSong(song: Song): void { this.practicePlayback.selectSong(song); }
  effectiveBpm(song: Song): number | null { return this.practicePlayback.effectiveBpm(song); }
  liveLoudnessGainDb(song: Song): number | null { return this.liveState.loudnessGainDb(song); }
  hasValidLoudness(song: Song): boolean { return this.liveState.hasValidLoudness(song); }

  liveDisplayedChords(song: Song): Array<ChordEvent & { displayed: string }> {
    return song.chords.map((chord) => ({
      ...chord,
      displayed: transposeChord(chord.canonicalChord, song.transposeSemitones)
    }));
  }

  liveCurrentChord(song: Song): (ChordEvent & { displayed: string }) | null {
    const time = this.chordDisplayTime(song, this.liveCurrentTime());
    for (let index = song.chords.length - 1; index >= 0; index--) {
      const chord = song.chords[index];
      const beat = song.beats[chord.beatIndex];
      if (beat && beat.timestampSeconds <= time + 0.01) {
        return { ...chord, displayed: transposeChord(chord.canonicalChord, song.transposeSemitones) };
      }
    }

    const first = song.chords[0];
    return first ? { ...first, displayed: transposeChord(first.canonicalChord, song.transposeSemitones) } : null;
  }

  liveChordTimelineTransform(song: Song): string {
    const time = this.chordDisplayTime(song, this.liveCurrentTime());
    if (!song.beats.length) {
      return 'translateX(0px)';
    }

    let currentBeatIndex = 0;
    for (let index = 0; index < song.beats.length; index++) {
      if (song.beats[index].timestampSeconds <= time) {
        currentBeatIndex = index;
      } else {
        break;
      }
    }

    const currentBeat = song.beats[currentBeatIndex];
    const nextBeat = song.beats[currentBeatIndex + 1];
    let fractionalBeatIndex = currentBeatIndex;

    if (currentBeat && nextBeat) {
      const span = nextBeat.timestampSeconds - currentBeat.timestampSeconds;
      if (span > 0) {
        fractionalBeatIndex += Math.max(0, Math.min(1, (time - currentBeat.timestampSeconds) / span));
      }
    }

    return `translateX(-${fractionalBeatIndex * this.chordWidthPx}px)`;
  }

  liveMidiEventLeftPx(song: Song, event: MidiEvent): number {
    const beat = song.beats.find((item) => item.id === event.anchorBeatId);
    return beat ? beat.index * this.chordWidthPx : 0;
  }

  private chordDisplayTime(song: Song, actualTime: number): number {
    if (!song.beats.length || this.chordDisplayLeadBeats <= 0) {
      return actualTime;
    }

    let beatDuration = 60 / (this.effectiveBpm(song) ?? song.bpm ?? 120);
    for (let index = 0; index < song.beats.length - 1; index++) {
      const currentBeat = song.beats[index];
      const nextBeat = song.beats[index + 1];
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
        container.scrollTo({ top: container.scrollTop - (containerRect.top + padding - rowRect.top), behavior: 'smooth' });
        return;
      }

      if (rowRect.bottom > containerRect.bottom - padding) {
        container.scrollTo({ top: container.scrollTop + (rowRect.bottom - (containerRect.bottom - padding)), behavior: 'smooth' });
      }
    });
  }
}
