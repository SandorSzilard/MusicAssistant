# Music Assistant - Project Context

This file is the implementation-facing source of truth for a fresh developer or AI assistant.

## Goal

Build a free, open-source, offline-first musician practice/live application for local audio tracks.

## Settled product rules

- Windows desktop is first; architecture/data should remain portable.
- Angular/TypeScript frontend, Tauri/Rust backend direction.
- Essentia.js/WASM is the chosen analysis engine candidate; bundle it locally, never require internet.
- Automatic chord recognition is **major/minor only**. Manual chord editing may store richer chord strings.
- Beat timestamps are canonical; do not require time-signature detection.
- Original audio is immutable.
- Transpose range is **-6..+6 semitones**.
- Canonical chords stay in original pitch. Editing a transposed view must inverse-transpose before saving.
- Tuning correction is separate from musical transpose and may use fractional semitones/cents.
- Signalsmith Stretch is the chosen pitch/time-processing library.
- Practice speed changes preserve pitch; transpose preserves tempo.
- 25% speed prioritizes intelligibility over fidelity.
- Count-in is N clicks then playback. In a loop, count-in happens only on the initial Play.
- Live Mode plays user-selected order; no DJ beatmatching, harmonic matching, or auto-mixing.
- Playlist songs should have consistent perceived loudness through non-destructive gain/normalization.
- Sidecars must identify the actual audio by content hash/fingerprint, not filename.
- MIDI is optional.
- MIDI events are anchored to a chord/beat plus an offset in milliseconds; negative offsets are required.
- A MIDI failure must never stop audio playback.
- Important user work must remain recoverable from portable files rather than one internal DB.

## Primary technical boundaries

### Frontend

Angular handles UI, state, waveform/chord visual interaction, playlist editing and MIDI configuration UI.

### Analysis worker

Essentia.js/WASM should run in a Worker. Target algorithms include RhythmExtractor2013, TuningFrequency, ChordsDetectionBeats and loudness analysis.

### Backend

Rust/Tauri handles OS-level filesystem access, hashing, MIDI, persistent files, validation, and eventually the production playback/rendering clock.

### DSP

Signalsmith Stretch handles independent time-stretch and pitch shift. Tuning cents and user transpose combine only at the audio-processing layer.

## Development rule

Proceed milestone-by-milestone. Do not rewrite architecture casually. If a major irreversible choice becomes necessary, document the options and add/update an ADR before proceeding.
