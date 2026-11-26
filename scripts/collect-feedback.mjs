import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('build-feedback');
mkdirSync(dir, { recursive: true });

function capture(name, cmd, args) {
  let out = '';
  try { out = execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore','pipe','pipe'] }); }
  catch (e) { out = `${e.stdout ?? ''}\n${e.stderr ?? ''}\n${e.message}`; }
  writeFileSync(resolve(dir, name), out, 'utf8');
}

capture('node-version.txt', process.execPath, ['--version']);
capture('npm-version.txt', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']);
capture('rustc-version.txt', 'rustc', ['--version']);
capture('cargo-version.txt', 'cargo', ['--version']);
capture('npm-ls.txt', process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ls', '--depth=0']);
capture('cargo-metadata.txt', 'cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--format-version', '1', '--no-deps']);
writeFileSync(resolve(dir, 'README.txt'), 'Send this entire build-feedback folder together with the first failing terminal output.\n', 'utf8');
console.log(`Diagnostics collected in ${dir}`);
