import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { calculateNextVersion, synchronizeVersion } from './version.mjs';

test('calculates stable semantic version bumps', () => {
  assert.equal(calculateNextVersion('0.1.9', 'patch'), '0.1.10');
  assert.equal(calculateNextVersion('0.1.9', 'minor'), '0.2.0');
  assert.equal(calculateNextVersion('0.1.9', 'major'), '1.0.0');
  assert.throws(() => calculateNextVersion('v0.1.9', 'patch'), /Expected stable/);
  assert.throws(() => calculateNextVersion('0.1.9', 'pre'), /Invalid version bump/);
});

test('synchronizes all release version metadata from package.json', () => {
  const root = mkdtempSync(join(tmpdir(), 'music-assistant-version-'));
  try {
    const tauriDirectory = join(root, 'src-tauri');
    mkdirSync(tauriDirectory, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'music-assistant', version: '0.1.9' }));
    writeFileSync(join(root, 'package-lock.json'), JSON.stringify({
      name: 'music-assistant',
      version: '0.1.9',
      packages: { '': { name: 'music-assistant', version: '0.1.9' } }
    }));
    writeFileSync(join(tauriDirectory, 'tauri.conf.json'), JSON.stringify({ version: '0.1.9' }));
    writeFileSync(join(tauriDirectory, 'Cargo.toml'), '[package]\nname = "music-assistant"\nversion = "0.1.9"\n\n[dependencies]\n');
    writeFileSync(join(tauriDirectory, 'Cargo.lock'), '[[package]]\nname = "music-assistant"\nversion = "0.1.9"\ndependencies = []\n');

    assert.equal(synchronizeVersion(root, 'minor'), '0.2.0');
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version, '0.2.0');
    assert.equal(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')).packages[''].version, '0.2.0');
    assert.equal(JSON.parse(readFileSync(join(tauriDirectory, 'tauri.conf.json'), 'utf8')).version, '0.2.0');
    assert.match(readFileSync(join(tauriDirectory, 'Cargo.toml'), 'utf8'), /^version = "0\.2\.0"$/m);
    assert.match(readFileSync(join(tauriDirectory, 'Cargo.lock'), 'utf8'), /name = "music-assistant"\nversion = "0\.2\.0"/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
