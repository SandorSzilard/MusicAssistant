# Current state after Chapter 8

This file describes the known-good behavior immediately after Chapter 8 (MIDI) was completed and manually verified.

## Stack

- Angular 21 / TypeScript frontend.
- Tauri 2 / Rust desktop backend.
- Essentia.js/WASM analysis worker.
- Signalsmith Stretch for practice/live pitch/time DSP.
- `midir` for MIDI input/output.
- CPAL is currently used for audio-device discovery/diagnostics, not as the active playback engine.

## Library

- Imports local MP3/WAV files and supports drag-and-drop.
- Source file is SHA-256 fingerprinted through the Rust backend.
- Original audio is never modified.
- Existing matching `.masidecar` is loaded when fingerprint/schema validation succeeds.
- Missing/unusable sidecar triggers analysis.

## Analysis

- Runs locally in a Web Worker using Essentia.js/WASM.
- Detects tuning first.
- If tuning deviation requires attention, analysis pauses for a user choice: keep original tuning or correct playback toward A=440.
- Full analysis produces BPM/beat timestamps, major/minor beat-aligned chords, key, waveform peaks, tuning data and loudness.
- Analysis decoding is centralized for production full-analysis and loudness-only paths.
- START/END changes trigger asynchronous loudness-only recalculation.
- Loudness recalculation has a per-song generation guard so stale async results cannot overwrite newer START/END calculations.

## Practice

- Signalsmith playback supports independent speed and pitch/tuning correction.
- Practice speed is not persisted as the user's song setting; source/song edits are portable.
- Transpose range is -6..+6 semitones.
- Count-in runs before each Play/Pause start when enabled.
- Song START/END boundaries are explicit user edits.
- Named colored sections can be created/edited/deleted and looped.
- Chords are editable; transposed-view edits are inverse-transposed before persistence.
- Waveform/chord timeline follows playback with current/next chord display.
- Permanent Practice header controls include `Analyze song` and `Save sidecar`.

## MIDI

- Enumerates MIDI outputs and inputs.
- Supports Program Change, Control Change and raw bytes.
- MIDI tab contains output test bench and input listener/monitor.
- Captured input messages can be copied/pasted into the MIDI-event workflow.
- MIDI events are attached to beat/chord anchors and support signed `offsetMs`.
- Events can override the global output device.
- Per-device timing compensation is persisted.
- Practice and Live both calculate event time as:

```text
anchor beat timestamp + (event offsetMs + selected-device timing compensation) / 1000
```

- Missing selected MIDI input/output is explicitly warned on device refresh; missing selection is cleared and persisted.
- MIDI send failure must not stop audio playback.
- Final Chapter 8 manual verification passed with a Boss GX-100: an event changed programs during playback and the event survived restart/recompile/re-import through the song sidecar.

## Live

- User-managed playlist/set supports ordering and per-song settings.
- Sequential playback is implemented.
- Per-song count-in and pause-after behavior exist.
- Global pause-between-songs controls exist.
- Live waveform/chord/MIDI timeline follows the active song.
- MIDI scheduler is active in Live.
- Loudness matching is optional and persisted globally.
- Current loudness policy is attenuation-only: target is the quietest finite LUFS value among playlist songs. Songs are never boosted above 0 dB.
- Playlist/set files are portable `.musicassistant` JSON files.

## Settings/help

- Settings page groups Audio, MIDI, Live, Help and Diagnostics.
- Audio follows the operating-system default output; the user changes it in the OS.
- MIDI output/input selections and timing compensation are persisted.
- Live loudness matching preference is persisted.
- Global keyboard-shortcut help is available through `?`, the header help button and Settings.

## Portable data

### Song sidecar

- Extension: `.masidecar` beside the source audio.
- Internal representation: JSON.
- Schema version: 1.
- Fingerprint mismatch or unsupported schema is rejected.
- Stores analysis plus user edits including tuning/transpose, START/END, count-in, sections, MIDI events and tempo multiplier.

### Playlist/set file

- Extension: `.musicassistant`.
- Internal representation: JSON.
- Schema version: 1.
- Stores playlist structure and song references/fingerprints.

### Global settings

- Portable settings JSON path is provided by the Rust backend.
- Stores MIDI selections/compensation and Live loudness matching.

## Known structural debt intentionally left for Chapter 9

At the Chapter 8 boundary the main files are very large (snapshot values):

- `app.component.ts` ~5,170 lines.
- `app.component.html` ~1,565 lines.
- `app.component.css` ~2,893 lines.
- `essentia.worker.ts` ~650 lines.

`AnalysisService` is stale scaffolding and still claims the analysis worker is not wired even though analysis is implemented. Chapter 9 must resolve stale scaffolding while preserving behavior.

## Snapshot warning

The ZIPs used to prepare the handoff predate the last Chapter 8 micro-fixes. The user's current working tree is authoritative. Do not overwrite current source with the ZIP snapshot.
