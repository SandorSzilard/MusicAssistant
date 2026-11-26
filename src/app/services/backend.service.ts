import { Injectable } from '@angular/core';
import { convertFileSrc, invoke, isTauri } from '@tauri-apps/api/core';
import { open, save } from '@tauri-apps/plugin-dialog';

export interface HealthInfo {
  appName: string;
  version: string;
  platform: string;
}

@Injectable({ providedIn: 'root' })
export class BackendService {
  get nativeAvailable(): boolean {
    return isTauri();
  }

  async health(): Promise<HealthInfo> {
    if (!isTauri()) return { appName: 'Music Assistant', version: 'browser-preview', platform: navigator.platform };
    return invoke<HealthInfo>('health_check');
  }

  async chooseAudioFile(): Promise<string | null> {
    if (!isTauri()) return null;
    const value = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav'] }]
    });
    return typeof value === 'string' ? value : null;
  }

  async chooseAudioReplacementFile(): Promise<string | null> {
    if (!isTauri()) return null;

    const value = await open({
      multiple: false,
      directory: false,
      filters: [{ name: 'Audio', extensions: ['mp3', 'wav'] }]
    });

    return typeof value === 'string' ? value : null;
  }

  async chooseFolder(): Promise<string | null> {
    if (!isTauri()) return null;

    const value = await open({
      multiple: false,
      directory: true
    });

    return typeof value === 'string' ? value : null;
  }

  async chooseImportFile(): Promise<string | null> {
    if (!isTauri()) return null;

    const value = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: 'Music Assistant / Audio',
          extensions: ['musicassistant', 'mp3', 'wav']
        }
      ]
    });

    return typeof value === 'string' ? value : null;
  }

  async chooseMusicAssistantSaveFile(defaultName = 'Live Set.musicassistant'): Promise<string | null> {
    if (!isTauri()) return null;

    const value = await save({
      defaultPath: defaultName,
      filters: [
        {
          name: 'Music Assistant',
          extensions: ['musicassistant']
        }
      ]
    });

    return typeof value === 'string' ? value : null;
  }

  async chooseMusicAssistantFile(): Promise<string | null> {
    if (!isTauri()) return null;

    const value = await open({
      multiple: false,
      directory: false,
      filters: [
        {
          name: 'Music Assistant',
          extensions: ['musicassistant']
        }
      ]
    });

    return typeof value === 'string' ? value : null;
  }

  assetUrl(path: string): string {
    return isTauri() ? convertFileSrc(path) : path;
  }

  async hashFile(path: string): Promise<string> {
    if (!isTauri()) throw new Error('File hashing requires the Tauri desktop app.');
    return invoke<string>('hash_file', { path });
  }

  async listAudioFilesRecursive(path: string): Promise<string[]> {
    if (!isTauri()) {
      throw new Error('Folder scanning requires the Tauri desktop app.');
    }

    return invoke<string[]>('list_audio_files_recursive', { path });
  }

  async listAudioOutputs(): Promise<string[]> {
    return isTauri() ? invoke<string[]>('list_audio_output_devices') : ['Browser default output'];
  }

  async listMidiOutputs(): Promise<string[]> {
    return isTauri() ? invoke<string[]>('list_midi_output_devices') : [];
  }

  async listMidiInputs(): Promise<string[]> {
    return isTauri() ? invoke<string[]>('list_midi_input_devices') : [];
  }

  async sendMidiBytes(deviceName: string, bytes: number[]): Promise<void> {
    if (!isTauri()) throw new Error('MIDI output requires the Tauri desktop app.');
    await invoke('send_midi_bytes', { deviceName, bytes });
  }

  async startMidiInputListener(deviceName: string): Promise<void> {
    if (!isTauri()) {
      throw new Error('MIDI input requires the Tauri desktop app.');
    }

    await invoke('start_midi_input_listener', {
      deviceName
    });
  }

  async stopMidiInputListener(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    await invoke('stop_midi_input_listener');
  }

  async saveText(path: string, content: string): Promise<void> {
    if (!isTauri()) throw new Error('Native file write requires the Tauri desktop app.');
    await invoke('save_text_file', { path, content });
  }

  async readText(path: string): Promise<string> {
    if (!isTauri()) throw new Error('Native file read requires the Tauri desktop app.');
    return invoke<string>('read_text_file', { path });
  }

  async portableSettingsPath(): Promise<string> {
    if (!isTauri()) {
      throw new Error('Portable settings require the Tauri desktop app.');
    }

    return invoke<string>('portable_settings_path');
  }
}
