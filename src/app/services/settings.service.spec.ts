import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendService } from './backend.service';
import { SettingsService } from './settings.service';

describe('SettingsService', () => {
  const backend = {
    portableSettingsPath: vi.fn<() => Promise<string>>(),
    readText: vi.fn<(path: string) => Promise<string>>(),
    saveText: vi.fn<(path: string, content: string) => Promise<void>>()
  };

  beforeEach(() => {
    backend.portableSettingsPath.mockReset().mockResolvedValue('settings.json');
    backend.readText.mockReset();
    backend.saveText.mockReset();
    TestBed.configureTestingModule({
      providers: [SettingsService, { provide: BackendService, useValue: backend }]
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('normalizes missing and malformed setting fields to supported defaults', async () => {
    const service = TestBed.inject(SettingsService);
    backend.readText.mockResolvedValue(JSON.stringify({
      schemaVersion: 99,
      midi: {
        outputDevice: 12,
        inputDevice: 'Input',
        deviceTimingCompensationMs: { Device: -7 }
      },
      live: { loudnessMatchingEnabled: false }
    }));

    await expect(service.load()).resolves.toEqual({
      schemaVersion: 1,
      midi: {
        outputDevice: '',
        inputDevice: 'Input',
        deviceTimingCompensationMs: { Device: -7 }
      },
      live: { loudnessMatchingEnabled: false }
    });

    backend.readText.mockResolvedValue('{');
    await expect(service.load()).resolves.toEqual(service.createDefaultSettings());
  });

  it('persists normalized settings to the portable settings path', async () => {
    const service = TestBed.inject(SettingsService);
    await service.save({
      schemaVersion: 1,
      midi: { outputDevice: 'Out', inputDevice: '', deviceTimingCompensationMs: {} },
      live: { loudnessMatchingEnabled: true }
    });

    expect(backend.saveText).toHaveBeenCalledWith('settings.json', JSON.stringify({
      schemaVersion: 1,
      midi: { outputDevice: 'Out', inputDevice: '', deviceTimingCompensationMs: {} },
      live: { loudnessMatchingEnabled: true }
    }, null, 2));
  });
});
