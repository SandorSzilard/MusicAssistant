# Music Assistant

Music Assistant is a free, open-source, offline-first desktop application for musicians who practice or perform with local audio tracks.

> **Current status:** working pre-release application. Chapters 0-8 are implemented and Chapter 8 (MIDI) has been manually verified with real hardware. The codebase is now entering refactor/test/hardening work before the remaining regional-analysis and release milestones.

## What works now

- Local MP3/WAV import and drag-and-drop.
- SHA-256 source fingerprinting; original audio is never modified.
- Local Essentia.js/WASM worker analysis: tuning, BPM/beats, major/minor chords, key, waveform peaks and loudness.
- Tuning-choice/correction workflow around A=440.
- Practice playback with Signalsmith Stretch, speed control, transpose, tuning correction, count-in, START/END and named loop sections.
- Editable beat-aligned chord timeline with current/next chord display.
- Portable `.masidecar` song sidecars with schema/fingerprint validation.
- Live playlists/sets with ordering, sequential playback, per-song count-in/pause behavior and `.musicassistant` save/load.
- Live loudness matching using attenuation-only gain toward the quietest analyzed playlist song.
- MIDI output/input enumeration, Program Change, Control Change and raw-byte sends.
- MIDI input monitor and copy/paste event workflow.
- Beat/chord-anchored scheduled MIDI with signed offsets, per-event device override and per-device timing compensation in Practice and Live.
- Persisted global MIDI/Live settings.
- Settings/diagnostics and keyboard-shortcut help.

## Core product rules

- Offline/local by default.
- Source MP3/WAV files are immutable.
- Important work is portable and must not exist only in hidden internal state.
- Canonical chords stay referenced to original pitch; editing a transposed view inverse-transposes before saving.
- Tuning correction is separate from musical transpose.
- MIDI is optional and MIDI failure must never stop audio playback.
- Current audio playback follows the operating-system default output device.

## Technology

- **Frontend:** Angular 21 + TypeScript
- **Desktop shell/backend:** Tauri 2 + Rust
- **Analysis:** Essentia.js / WASM in a Web Worker
- **Pitch/time DSP:** Signalsmith Stretch
- **MIDI:** midir
- **Audio-device diagnostics:** CPAL

## Development prerequisites

Windows development currently expects:

1. Node.js 20.19+ (Node 22 LTS recommended).
2. Rust stable with Cargo and rustfmt.
3. Microsoft C++ / Visual Studio Build Tools required by Tauri/Rust.
4. WebView2 Runtime.

## Setup and common commands

```bash
npm run setup
npm run doctor
npm run dev
```

Useful existing commands:

```bash
npm run frontend:dev
npm run frontend:build
npm run rust:fmt
npm run rust:check
npm run build:app
npm run release:local
npm run feedback
```

Automated test commands will be added in Chapter 10.

## Keyboard help

Press `?` anywhere outside a typing field, use the top-right help button, or open **Settings -> Shortcuts / Help**.

## Portable files

### Song sidecar

A song's portable metadata is stored beside it as:

```text
<original audio path>.masidecar
```

The file is JSON internally, schema-versioned, and tied to the actual source audio fingerprint.

### Playlist/set

Live playlists are stored as `.musicassistant` files and reference songs by portable metadata/fingerprint.

## Documentation

Start with:

- `docs/CURRENT_STATE_AFTER_CHAPTER_8.md`
- `docs/BEHAVIOR_CONTRACTS.md`
- `docs/ARCHITECTURE.md`
- `docs/ARCHITECTURE_DECISIONS.md`
- `docs/ROADMAP.md`
- `.github/copilot-instructions.md` for repository-aware coding agents.

## License

AGPL-3.0-or-later. Review dependency/license implications before public release.
