# Build feedback checklist

After downloading and extracting the repository on your Windows development machine:

1. Open a terminal in the repository root.
2. Run `npm run setup`.
3. Run `npm run doctor`.
4. Run `npm run dev`.
5. If development mode works, try `npm run build:app`.
6. Optionally try `npm run release:local`.
7. Run `npm run feedback`.

Send back:

- the complete terminal output from the first failing command;
- the generated `build-feedback/` folder;
- a screenshot if the app opens but the UI/behavior is wrong;
- Windows version;
- whether Visual Studio Build Tools are installed;
- any audio/MIDI device behavior you tested.

Do **not** spend a long time manually fixing dependencies before sending the log back. The first build is specifically meant to reveal environment and API/version differences.
