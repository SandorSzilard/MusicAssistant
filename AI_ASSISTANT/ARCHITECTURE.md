# Architecture

```text
Angular UI
  |-- Library / Practice / Live / MIDI / Settings
  |-- typed domain state
  |-- analysis worker -> Essentia.js/WASM
  |-- practice DSP adapter -> Signalsmith Stretch
  |
  +---- Tauri IPC --------------------------------+
                                                   |
Rust backend                                       |
  |-- file hashing / sidecars / playlists          |
  |-- audio device enumeration (CPAL)              |
  |-- MIDI I/O (midir; wmidi-compatible model)     |
  |-- validation                                   |
  |-- future native playback clock/rendering       |
  +------------------------------------------------+
```

## Reliability boundaries

- analysis failure -> playback should survive;
- MIDI failure -> playback should survive;
- waveform/UI error -> playback service should survive;
- source mismatch -> reject sidecar rather than silently using wrong timing;
- Live Mode should validate expensive/risky work before starting.

## Canonical vs derived state

Canonical/portable:
- source-audio fingerprint;
- beat map;
- original-reference chord timeline;
- manual chord corrections;
- start/end;
- transpose;
- tuning/loudness analysis;
- MIDI events;
- playlists.

Derived/disposable:
- prepared transposed audio;
- waveform cache;
- UI/session state;
- current practice speed;
- current loop selection.

## Analysis flow

```text
MP3/WAV -> decode/mono analysis signal
        -> fingerprint
        -> beat/BPM analysis
        -> tuning analysis
        -> HPCP/chroma
        -> ChordsDetectionBeats (major/minor)
        -> loudness analysis
        -> sidecar
```

## MIDI timing

```text
scheduled MIDI time = anchor beat timestamp + offsetMs
```

Offsets can be negative. Pre-roll/count-in gives room for events that must fire before time zero.
