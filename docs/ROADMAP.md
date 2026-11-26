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

## Remaining agent-assisted chapters

### Chapter 9 - Git baseline + behavior-preserving refactor
- initialize local Git safely if not already initialized; no remote/push;
- create a baseline commit before structural edits;
- split oversized Angular root component/template/styles into coherent feature boundaries;
- move analysis/playback/MIDI/Live/settings orchestration into appropriate services/helpers/components;
- resolve stale scaffolding such as the obsolete `AnalysisService` message;
- preserve current behavior and portable schemas.

### Chapter 10 - Automated tests + quality gates
- add Angular/TypeScript unit-test infrastructure;
- add unit tests for extracted pure/business logic;
- add deterministic Rust tests where useful;
- add CI-friendly test scripts, formatting/type/build checks and sensible coverage reporting;
- hardware-dependent behavior remains mocked plus a manual hardware checklist.

### Chapter 11 - Regional analysis correction
- select a waveform/time region;
- re-analyze beats/chords/both only where requested;
- merge results safely;
- preserve manual edits according to explicit merge/conflict rules;
- persist results and cover merge behavior with tests.

### Chapter 12 - Hardening + release automation
- long-playlist/missing-file/device-change/malformed-data robustness;
- update docs and repository hygiene;
- manual GitHub Actions release workflow (`workflow_dispatch`) with branch and patch/minor/major inputs;
- synchronized version bump across npm/Tauri/Cargo metadata;
- clean dependency install and all quality gates before release;
- separate Windows/Linux/macOS builds/artifacts;
- tag and GitHub Release creation only after successful validation.
