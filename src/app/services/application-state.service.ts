import { Injectable, signal } from '@angular/core';
import { HealthInfo } from './backend.service';

export type AppTab = 'library' | 'practice' | 'live' | 'midi' | 'settings';

@Injectable({ providedIn: 'root' })
export class ApplicationStateService {
  readonly tab = signal<AppTab>('library');
  readonly status = signal('Ready');
  readonly health = signal<HealthInfo | null>(null);
}
