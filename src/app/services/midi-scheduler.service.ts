import { Injectable } from '@angular/core';
import { MidiEvent, Song } from '../models/domain.models';

export interface MidiScheduleCursor {
  lastPlaybackTime: number;
  firedEventIds: Set<string>;
}

@Injectable({ providedIn: 'root' })
export class MidiSchedulerService {
  createCursor(): MidiScheduleCursor {
    return {
      lastPlaybackTime: 0,
      firedEventIds: new Set<string>()
    };
  }

  reset(
    song: Song,
    cursor: MidiScheduleCursor,
    playbackTime: number,
    activeDevice: string,
    deviceTimingCompensationMs: Record<string, number>
  ): void {
    cursor.firedEventIds.clear();
    cursor.lastPlaybackTime = playbackTime;

    for (const event of song.midiEvents) {
      const triggerTime = this.triggerTime(song, event, activeDevice, deviceTimingCompensationMs);

      if (triggerTime !== null && triggerTime < playbackTime - 0.02) {
        cursor.firedEventIds.add(event.id);
      }
    }
  }

  advance(
    song: Song,
    cursor: MidiScheduleCursor,
    playbackTime: number,
    activeDevice: string,
    deviceTimingCompensationMs: Record<string, number>
  ): MidiEvent[] {
    if (playbackTime < cursor.lastPlaybackTime - 0.1) {
      this.reset(song, cursor, playbackTime, activeDevice, deviceTimingCompensationMs);
      return [];
    }

    const dueEvents: MidiEvent[] = [];

    for (const event of song.midiEvents) {
      if (cursor.firedEventIds.has(event.id)) {
        continue;
      }

      const triggerTime = this.triggerTime(song, event, activeDevice, deviceTimingCompensationMs);

      if (triggerTime !== null && playbackTime >= triggerTime) {
        cursor.firedEventIds.add(event.id);
        dueEvents.push(event);
      }
    }

    cursor.lastPlaybackTime = playbackTime;
    return dueEvents;
  }

  triggerTime(song: Song, event: MidiEvent, activeDevice: string, deviceTimingCompensationMs: Record<string, number>): number | null {
    const beat = song.beats.find((item) => item.id === event.anchorBeatId);

    if (!beat) {
      return null;
    }

    const deviceName = event.deviceName || activeDevice;
    const deviceTimingMs = deviceName ? (deviceTimingCompensationMs[deviceName] ?? 0) : 0;

    return beat.timestampSeconds + (event.offsetMs + deviceTimingMs) / 1000;
  }
}
