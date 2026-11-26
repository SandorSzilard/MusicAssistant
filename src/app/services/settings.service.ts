import { Injectable, inject } from '@angular/core';
import { BackendService } from './backend.service';

export interface MusicAssistantSettings {
  schemaVersion: 1;

  midi: {
    outputDevice: string;
    inputDevice: string;
    deviceTimingCompensationMs: Record<string, number>;
  };

  live: {
    loudnessMatchingEnabled: boolean;
  };
}

const DEFAULT_SETTINGS: MusicAssistantSettings = {
  schemaVersion: 1,

  midi: {
    outputDevice: '',
    inputDevice: '',
    deviceTimingCompensationMs: {}
  },

  live: {
    loudnessMatchingEnabled: true
  }
};

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  private readonly backend = inject(BackendService);

  private settingsPath: string | null = null;

  async load(): Promise<MusicAssistantSettings> {
    const path = await this.getSettingsPath();

    try {
      const content = await this.backend.readText(path);
      const parsed = JSON.parse(content) as Partial<MusicAssistantSettings>;

      return this.normalize(parsed);
    } catch {
      return this.createDefaultSettings();
    }
  }

  async save(settings: MusicAssistantSettings): Promise<void> {
    const path = await this.getSettingsPath();

    const normalized = this.normalize(settings);

    await this.backend.saveText(path, JSON.stringify(normalized, null, 2));
  }

  async path(): Promise<string> {
    return this.getSettingsPath();
  }

  createDefaultSettings(): MusicAssistantSettings {
    return {
      schemaVersion: 1,

      midi: {
        outputDevice: '',
        inputDevice: '',
        deviceTimingCompensationMs: {}
      },

      live: {
        loudnessMatchingEnabled: true
      }
    };
  }

  private async getSettingsPath(): Promise<string> {
    if (!this.settingsPath) {
      this.settingsPath = await this.backend.portableSettingsPath();
    }

    return this.settingsPath;
  }

  private normalize(settings: Partial<MusicAssistantSettings>): MusicAssistantSettings {
    return {
      schemaVersion: 1,

      midi: {
        outputDevice: typeof settings.midi?.outputDevice === 'string' ? settings.midi.outputDevice : '',

        inputDevice: typeof settings.midi?.inputDevice === 'string' ? settings.midi.inputDevice : '',

        deviceTimingCompensationMs: settings.midi?.deviceTimingCompensationMs && typeof settings.midi.deviceTimingCompensationMs === 'object' ? { ...settings.midi.deviceTimingCompensationMs } : {}
      },

      live: {
        loudnessMatchingEnabled: typeof settings.live?.loudnessMatchingEnabled === 'boolean' ? settings.live.loudnessMatchingEnabled : true
      }
    };
  }
}
