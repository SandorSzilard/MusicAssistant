# Releasing

The supported release process is the manually triggered GitHub Actions workflow. It validates the selected branch, bumps synchronized project metadata, runs the CI quality gates, creates native platform installers, and publishes only after all four required artifacts have succeeded.

## GitHub UI

1. Open **Actions**.
2. Select **Release**.
3. Choose **Run workflow**.
4. Select the release branch from the normal branch/ref selector. The branch must be current with its remote tip.
5. Choose `patch`, `minor`, or `major`.
6. For the first workflow exercise, set **Build all installers without committing, tagging, or publishing** to `true`. This validates every platform build and uploads temporary workflow artifacts without writing to the branch or creating a GitHub Release.
7. After reviewing a successful dry run, run it again with the same branch and bump but set the dry-run option to `false` to perform the release.

Dry-run builds upload temporary artifacts for seven days. Their Actions artifact names are `MusicAssistant-X.Y.Z-Windows-x64`, `MusicAssistant-X.Y.Z-Linux-x64`, `MusicAssistant-X.Y.Z-macOS-x64`, and `MusicAssistant-X.Y.Z-macOS-arm64`.

The release command increments the existing stable semantic version in `package.json`. The version synchronization script checks and updates:

- `package.json` and the root metadata in `package-lock.json`;
- `src-tauri/tauri.conf.json`;
- the root package in `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock`.

All versions must agree before it writes. Do not update these versions independently. The automated version commit is pushed to the selected branch after the tests/build validation succeed. Native builds then use that commit. The `vX.Y.Z` tag and GitHub Release are created only after all required installers are uploaded and verified; a failed matrix job cannot publish a partial release.

## Release artifacts

The workflow names downloaded installers with the product, version, OS, and architecture:

- `MusicAssistant-X.Y.Z-Windows-x64-setup.exe` — Tauri NSIS installer;
- `MusicAssistant-X.Y.Z-Linux-x64.deb` — Debian/Ubuntu package;
- `MusicAssistant-X.Y.Z-macOS-x64.dmg` — Intel macOS disk image;
- `MusicAssistant-X.Y.Z-macOS-arm64.dmg` — Apple Silicon macOS disk image.

Each uploaded Actions artifact contains the corresponding installer file listed above. The final GitHub Release attaches all four installer files.

Linux users need a Debian/Ubuntu-compatible distribution and the runtime libraries required by Tauri/WebKitGTK. Windows and macOS release installers are not currently code-signed; Windows SmartScreen may show a warning, and macOS Gatekeeper may require the user to approve an unsigned app. Signing and notarization are future distribution work and no signing secrets are used by this workflow.

## Permissions and branch protection

Workflow jobs default to `contents: read`. Only the version-commit job and final publish job receive `contents: write`; neither uses a personal access token. A per-repository concurrency lock prevents two manual release runs from racing.

The selected branch must permit the GitHub Actions token to push the version commit. If branch protection or a ruleset blocks that write, the workflow stops before platform builds and no tag or release is created. Do not weaken protections or force-push to work around this. Before a production run, administrators must either authorize the GitHub Actions bot for this specific release-branch write under the repository's approved ruleset, or choose a release branch whose existing policy permits it. The workflow never bypasses a protection rule itself.

## Local packaging

On a supported host, `npm ci` followed by `npm run release:local` builds the native installer and copies it to `dist/releases/`. To print the expected bundle and artifact path without building, use `npm run package:release -- --dry-run`. A local build on one OS does not substitute for the four native GitHub runner builds.
