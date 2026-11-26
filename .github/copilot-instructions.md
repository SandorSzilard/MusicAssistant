# GitHub Copilot instructions - Music Assistant

Read these before editing:

1. `docs/CURRENT_STATE_AFTER_CHAPTER_8.md`
2. `docs/BEHAVIOR_CONTRACTS.md`
3. `docs/ARCHITECTURE.md`
4. `docs/ARCHITECTURE_DECISIONS.md`
5. `docs/ROADMAP.md`
6. `AI_ASSISTANT/DEVELOPMENT_RULES.md`

## Non-negotiable product rules

- Preserve the working product. Do not rewrite from scratch.
- Core use is offline/local. Do not add mandatory cloud/network services.
- Never modify source MP3/WAV files.
- Sidecars are portable user data and are bound to source audio by SHA-256 fingerprint.
- Current sidecar extension is `.masidecar`; do not add legacy `.musicassistant.json` compatibility unless explicitly requested.
- Playlist/set files use `.musicassistant`.
- Canonical chords remain referenced to original pitch. UI edits in transposed view must inverse-transpose before persistence.
- Automatic chord recognition is intentionally limited; user-edited chord strings may be richer.
- Tuning correction and musical transpose are separate concepts.
- MIDI is optional. MIDI failure must not stop audio playback.
- Scheduled MIDI events are anchored to beat/chord timing and support signed millisecond offsets.
- Per-device MIDI timing compensation applies consistently in Practice and Live.
- Practice `Analyze song` and `Save sidecar` controls are permanent user-facing controls.
- Live loudness matching is attenuation-only: target the quietest valid analyzed song and never boost louder/unknown tracks above 0 dB gain.
- The application currently follows the operating system default audio output. Do not reintroduce WebView audio-device selection without an explicit architecture decision.

## Refactoring rules

- Refactor behavior-preservingly and incrementally.
- Prefer focused services/helpers/models/components instead of growing `AppComponent` further.
- Do not introduce a framework/state-management rewrite.
- Do not change persisted file schemas casually.
- When moving code, preserve existing behavior first; improve architecture second.
- Do not delete test/diagnostic helpers merely because they are not exposed in normal UI if they can be converted into automated tests later.
- Avoid `any` when practical. Keep public boundaries typed.
- Keep workers off Angular's UI thread.
- Keep DSP lifecycle isolated from analysis lifecycle.

## Git/safety rules

- Never push to any remote unless the user explicitly requests it in that turn.
- Never create a GitHub repository automatically.
- Never force-push, rewrite history, delete branches, or run destructive reset/clean commands without explicit approval.
- Local `git init`, local commits, branches, and tags are allowed only when the chapter prompt explicitly requests them.
- Do not store secrets/tokens in the repository.

## Validation rule

At the end of every chapter:

1. run the chapter's requested checks;
2. summarize files changed and commands run;
3. list any warnings/failures honestly;
4. **STOP** and wait for the user to manually test the application.

Do not start the next chapter automatically.
