# Roadmap

## Completed foundation (Chapters 0-8)

### Chapter 0 - Repository / desktop skeleton
- Angular + Tauri foundation and IPC proof.

### Chapter 1 - Playback foundation
- working local playback/DSP path and playback clock behavior used by current Practice/Live implementation.

### Chapter 2 - Essentia analysis
- local worker analysis for tuning, BPM/beats, chords, key, waveform and loudness.

### Chapter 3 - Waveform / chord timeline
- synchronized timeline, current/next chord and manual editing.

### Chapter 4 - Portable sidecars / song edits
- fingerprint-bound `.masidecar` v1 and persistent user edits.

### Chapter 5 - Practice
- count-in, sections/loops, speed, transpose/tuning correction and related persistence.

### Chapter 6 - Live preparation/playback
- portable set files, sequential playback, count-in/pause controls and loudness matching.

### Chapter 7 - Settings / help / UI cleanup
- persistent settings, MIDI/settings redesign and global shortcut help.

### Chapter 8 - MIDI - COMPLETE
- output/input enumeration;
- Program Change / CC / raw bytes;
- output test bench;
- input listener/monitor and copy/paste workflow;
- beat/chord anchoring;
- signed offsets;
- per-event device selection;
- per-device timing compensation;
- Practice + Live scheduling;
- disconnect warning;
- sidecar persistence verified with real GX-100 hardware.

## Chapter status

### Chapter 9 - Git baseline + behavior-preserving refactor
- Status: complete; behavior manually verified.
- refactored the application shell and split Library, Practice, Live, MIDI, and Settings UI by feature;
- extracted analysis, playback, state, and MIDI scheduling orchestration into focused services;
- retained the existing persistence schemas and behavior contracts.

### Chapter 10 - Automated tests + quality gates
- Status: complete; CI-quality checks and focused tests are in place.
- Angular/Vitest unit testing, TypeScript checks, coverage, and Rust hashing tests are configured;
- CI-ready frontend, Rust formatting, compilation, and build scripts are available;
- hardware-dependent behavior remains mocked plus a manual hardware checklist.

### Chapter 11 - Regional analysis correction
- Status: complete; implementation and regression behavior manually verified.
- regional beat/chord analysis, merge/remapping, persistence, and regression coverage are implemented;
- manual chord edits are preserved according to the regional merge policy;
- full-song analysis confirms before replacing manual chord edits.

### Chapter 12 - Hardening + release automation
- Status: implementation ready for review; cross-platform runners and first workflow dry run require GitHub Actions validation.
- adds focused import, analysis-worker, and MIDI device/listener failure-path coverage;
- repository docs and generated/user data exclusions are synchronized;
- the manual `workflow_dispatch` release workflow validates and synchronizes versions before building separate platform artifacts;
- GitHub Release creation is gated on successful Windows, Linux, and macOS installer builds.
