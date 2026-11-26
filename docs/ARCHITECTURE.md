# Architecture

This describes the working architecture after the Chapter 9 refactor. The Chapter 8 behavior contracts remain unchanged.

```text
Angular UI
  |-- AppComponent application shell / keyboard and tab coordinator
  |-- LibraryPageComponent / PracticePageComponent / LivePageComponent
  |-- MidiPageComponent / SettingsPageComponent
  |-- feature state and orchestration services
  |-- sidecar / playlist / settings services
  |-- AnalysisOrchestratorService ------------+
  |     |-- decoded analysis audio             |
  |     |-- typed Essentia worker session      |
  |     |-- analysis queue / tuning / loudness |
  |-- PracticePlaybackService                 |
  |-- LivePlaybackService / LivePlaylistService
  |-- MidiSchedulerService / MidiDeviceService
  |-- Signalsmith DSP playback                 |
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

## Frontend component and analysis boundaries

`AppComponent` is the application shell and top-level coordinator. It handles app-wide navigation, keyboard shortcuts, native file-drop integration, and connects imported songs to feature workflows. The Library, Practice, Live, MIDI, and Settings pages have dedicated components with page markup and styles kept alongside the component.

`LibraryService` owns the song collection and selection. `LibraryImportService` coordinates local file hashing, `.masidecar` loading, and automatic analysis queueing without modifying source audio. `SidecarService`, `SettingsService`, and `BackendService` retain their persistence and platform boundaries.

`PracticeStateService` and `PracticePlaybackService` own Practice state and playback/count-in orchestration. `PracticePageComponent` owns Practice UI interactions and its page markup. `AnalysisOrchestratorService` owns analysis queueing, tuning choice, full/loudness analysis coordination, sidecar saves, and stale-result protection. Analysis decoding and Essentia worker communication remain separate from DSP playback.

The analysis worker dynamically loads the package's local `essentia-wasm.es.js` ESM asset and queues incoming requests until Essentia initialization completes. This keeps WASM analysis in the worker and works without a network dependency.

`LiveStateService` owns playlist and playback state. `LivePlaybackService` owns sequence progression, clocks, count-in and Live MIDI scheduling. `LivePlaylistService` owns set persistence, recovery/relink operations, and playlist settings. `LivePageComponent` owns Live presentation and page-level interactions.

`MidiSchedulerService` shares beat-anchored scheduling rules between Practice and Live. The trigger remains `anchor time + signed event offset + selected-device timing compensation`. `MidiDeviceService` owns device selection, monitoring, event sending, and persisted MIDI device settings.

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

## Remaining structural debt

`PracticePageComponent` and `LivePlaybackService` remain the largest feature files and may need further decomposition. The root stylesheet now contains shared shell and cross-page styles; page-specific Practice, Live, and Library rules are colocated with their page components. Any further decomposition must preserve the behavior contracts in `docs/BEHAVIOR_CONTRACTS.md`.
