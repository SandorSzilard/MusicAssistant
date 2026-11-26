# Architecture

This describes the working architecture at the end of Chapter 8. Chapter 9 is expected to improve file/component boundaries without changing these behaviors.

```text
Angular UI
  |-- Library / Practice / Live / MIDI / Settings
  |-- typed domain state
  |-- sidecar / playlist / settings services
  |-- Essentia Web Worker -------------------+
  |-- Signalsmith DSP playback               |
  |-- Practice + Live MIDI schedulers        |
  |                                          |
  +---- Tauri IPC ---------------------------|-----------+
                                             |           |
Rust backend                                 |           |
  |-- SHA-256/file access                    |           |
  |-- portable settings path                 |           |
  |-- recursive local audio discovery        |           |
  |-- MIDI input/output via midir <----------+           |
  |-- audio-output enumeration via CPAL                  |
  +------------------------------------------------------+
```

## Current playback boundary

Signalsmith/Web Audio is the active playback/DSP path. Playback follows the operating-system default audio output. CPAL currently enumerates outputs for diagnostics; it is not the active playback engine.

Do not reintroduce a WebView output-device picker as if it were a complete playback-device solution.

## Analysis flow

```text
source audio
  -> frontend decode for analysis
  -> tuning-only worker pass
      -> user choice if tuning needs attention
  -> full worker analysis with chosen tuning reference
      -> BPM / beats
      -> beat-aligned major/minor chords
      -> key
      -> waveform peaks
      -> loudness over usable START/END range
  -> Song state
  -> .masidecar
```

START/END edits trigger a lighter loudness-only worker pass. A per-song generation counter rejects stale overlapping results.

## DSP flow

```text
source audio -> Signalsmith Stretch -> output GainNode -> OS default output
```

Pitch/time responsibilities:
- practice rate controls tempo without intentionally changing pitch;
- musical transpose is integer semitones (-6..+6);
- tuning correction is independent and may be fractional cents/semitones;
- effective DSP shift combines musical transpose + enabled tuning correction at the DSP boundary.

## Live loudness flow

```text
playlist finite LUFS values
  -> quietest value = target
  -> gainDb = min(0, target - songLufs)
  -> DSP output gain
```

This policy only attenuates; it never boosts a song above 0 dB.

## MIDI flow

```text
MidiEvent
  -> anchor beat/chord
  -> resolve per-event device override or global device
  -> add event offsetMs
  -> add per-device timing compensation
  -> scheduler compares against canonical playback time
  -> BackendService
  -> Tauri command
  -> midir
```

Effective trigger time:

```text
anchorSeconds + (offsetMs + deviceTimingCompensationMs) / 1000
```

Practice and Live must use the same rule.

MIDI input:

```text
midir input connection -> Tauri event -> Angular monitor -> copy/paste event payload
```

## Persistence

### `.masidecar`

Canonical portable per-song data:
- audio fingerprint;
- BPM/beats/chords/key/tuning/loudness/waveform peaks;
- transpose;
- source tuning/correction settings;
- START/END;
- count-in;
- MIDI events;
- named sections;
- tempo multiplier.

### `.musicassistant`

Portable playlist/set file with song references/fingerprints and playlist-entry settings.

### Global settings

Persisted separately through `SettingsService` and Rust-provided portable settings path. Currently includes MIDI device selections/timing compensation and Live loudness-matching preference.

## Reliability boundaries

- analysis failure must not unnecessarily break playback;
- MIDI failure/disconnect must not stop audio;
- stale async analysis results must not overwrite newer user edits;
- sidecar fingerprint/schema mismatch must be rejected safely;
- source audio remains immutable;
- Live should validate/prepare risky work before performance when practical.

## Structural debt at Chapter 8 boundary

The root component/template/styles have grown too large and contain multiple feature responsibilities. Chapter 9 should extract coherent services/components/helpers incrementally while preserving the behavior contracts in `docs/BEHAVIOR_CONTRACTS.md`.
