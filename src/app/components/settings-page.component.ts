import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-settings-page',
  standalone: true,
  templateUrl: './settings-page.component.html',
  styleUrl: './settings-page.component.css'
})
export class SettingsPageComponent {
  @Input() activeMidiDevice = '';
  @Input() activeMidiInputDevice = '';
  @Input() midiTimingCompensationMs = 0;
  @Input() liveLoudnessMatchingEnabled = true;
  @Input() isDesktop = false;
  @Input() version: string | null = null;
  @Input() midiOutputsCount = 0;
  @Input() midiInputsCount = 0;

  @Output() refreshDevices = new EventEmitter<void>();
  @Output() openShortcutHelp = new EventEmitter<void>();
  @Output() openMidiSettings = new EventEmitter<void>();
  @Output() liveLoudnessMatchingChange = new EventEmitter<boolean>();
}
