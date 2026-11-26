# Development rules for AI assistants

- Do not start from scratch if the repository already contains working code.
- Do not silently replace Angular, Tauri, Essentia.js, or Signalsmith without a documented blocking reason.
- Keep source audio immutable.
- Keep network/cloud functionality optional; the core app must remain offline.
- Keep MIDI optional and isolated from core playback reliability.
- Prefer portable, schema-versioned user data over hidden DB-only state.
- Automatic chord recognition is deliberately simple; manual chord vocabulary can be richer.
- Keep canonical chords referenced to original pitch; inverse-transpose edits from the UI.
- Test Windows first.
- Pin dependency versions before releases and review upgrades deliberately.
- Update docs/ and ADRs whenever behavior/architecture changes materially.
- Ask for or inspect build logs instead of guessing at environment failures.
