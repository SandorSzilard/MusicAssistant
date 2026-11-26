# Agent work plan after Chapter 8

This plan deliberately separates architecture cleanup, testing, the last planned feature milestone, and release automation.

## Chapter 9 - Git baseline + behavior-preserving refactor

Goal: make the working codebase maintainable without changing product behavior.

Key outcomes:
- initialize local Git if needed and create a safe baseline commit (no remote/push);
- break the oversized root component/template/styles into coherent feature components/services/helpers;
- migrate real analysis orchestration out of stale `AnalysisService` scaffolding or remove/replace that scaffolding cleanly;
- preserve all behavior contracts;
- keep the project compiling after incremental moves.

## Chapter 10 - Automated tests + quality gates

Goal: create a meaningful safety net before adding another feature.

Key outcomes:
- add unit-test tooling compatible with Angular 21/TypeScript;
- test pure utilities, persisted-file validation, settings normalization, MIDI timing/message conversion, loudness policy, analysis mapping/orchestration boundaries and other extracted logic;
- add Rust tests for deterministic backend helpers where practical;
- add `npm test`/CI-friendly scripts;
- add lint/type/build/format/coverage gates without requiring hardware in CI.

Hardware-dependent MIDI/audio behavior should be isolated behind mocks/fakes in automated tests and still have a manual checklist.

## Chapter 11 - Regional analysis correction

Goal: implement the roadmap's regional reanalysis feature on top of the refactored/tested architecture.

Key outcomes:
- select a waveform/time region;
- choose re-analyze beats, chords, or both;
- run only the needed analysis for the selected range;
- merge corrected results safely;
- do not casually discard manual chord edits outside/inside the region;
- persist corrected analysis in `.masidecar`;
- add automated tests for merge/conflict rules.

## Chapter 12 - Hardening + GitHub CI/release automation

Goal: make the repository release-ready without pushing from the agent session.

Key outcomes:
- repository hygiene/docs finalization;
- long-playlist/malformed-file/device-change robustness checks;
- cross-platform build jobs where supported;
- manual GitHub Actions release workflow with branch selection and `patch|minor|major` bump;
- synchronize version in package/Cargo/Tauri canonical files;
- clean install, tests and build gates before release;
- build separate Windows/Linux/macOS artifacts;
- create a version tag and GitHub Release only after all jobs succeed;
- no automatic remote push during local setup.

## Stop rule

Each chapter ends with an agent summary and STOP. The user manually runs/tests the app before the next prompt is issued.
