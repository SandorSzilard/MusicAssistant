import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageScript = join(root, 'scripts', 'package-release.mjs');
const targets = [
  {
    triple: 'x86_64-pc-windows-msvc',
    artifact: 'MusicAssistant-1.2.3-Windows-x64.zip',
    build: 'Tauri build: executable only (--no-bundle)',
    contents: 'Archive contents: MusicAssistant.exe'
  },
  {
    triple: 'x86_64-unknown-linux-gnu',
    artifact: 'MusicAssistant-1.2.3-Linux-x64.AppImage',
    build: 'Tauri bundle: appimage'
  },
  {
    triple: 'x86_64-apple-darwin',
    artifact: 'MusicAssistant-1.2.3-macOS-x64.zip',
    build: 'Tauri bundle: app'
  },
  {
    triple: 'aarch64-apple-darwin',
    artifact: 'MusicAssistant-1.2.3-macOS-arm64.zip',
    build: 'Tauri bundle: app'
  }
];

test('release dry runs report portable artifacts without building or writing output', () => {
  const tempRoot = mkdtempSync(join(tmpdir(), 'music-assistant-release-dry-run-'));
  try {
    writeFileSync(join(tempRoot, 'package.json'), JSON.stringify({ version: '1.2.3' }));
    for (const target of targets) {
      const output = execFileSync(process.execPath, [
        packageScript,
        '--target',
        target.triple,
        '--dry-run'
      ], { cwd: tempRoot, encoding: 'utf8' });

      assert.ok(output.includes(target.build), `Missing build mode for ${target.triple}`);
      assert.ok(output.includes(target.artifact), `Missing portable artifact name for ${target.triple}`);
      if (target.contents) {
        assert.ok(output.includes(target.contents), `Missing archive contents for ${target.triple}`);
      }
      assert.doesNotMatch(output, /-setup\.exe|\.deb|\.dmg/i);
    }
    assert.equal(existsSync(join(tempRoot, 'dist')), false);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
});
