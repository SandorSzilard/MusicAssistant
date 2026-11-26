import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { Song } from '../models/domain.models';
import { LibraryService } from '../services/library.service';
import { LiveStateService } from '../services/live-state.service';

@Component({
  selector: 'app-library-page',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './library-page.component.html',
  styleUrl: './library-page.component.css'
})
export class LibraryPageComponent {
  readonly Math = Math;
  @Input() isDragOver = false;
  @Output() importRequested = new EventEmitter<void>();
  @Output() practiceRequested = new EventEmitter<Song>();
  @Output() addToLiveRequested = new EventEmitter<Song>();

  readonly library = inject(LibraryService);
  private readonly liveState = inject(LiveStateService);

  isSongInPlaylist(songId: string): boolean {
    return this.liveState.isSongInPlaylist(songId);
  }
}
