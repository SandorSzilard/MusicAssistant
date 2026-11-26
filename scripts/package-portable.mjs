import { createWriteStream, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import archiver from 'archiver';

const target = resolve('src-tauri/target/release');
const outRoot = resolve('dist/portable');
const folder = join(outRoot, 'MusicAssistant-Windows-x64');
mkdirSync(outRoot, { recursive: true });
rmSync(folder, { recursive: true, force: true });
mkdirSync(folder, { recursive: true });

if (!existsSync(target)) throw new Error(`Release folder not found: ${target}. Run npm run build:app first.`);

const exe = readdirSync(target)
  .map(name => join(target, name))
  .find(path => statSync(path).isFile() && basename(path).toLowerCase().endsWith('.exe') && !basename(path).includes('build-script'));
if (!exe) throw new Error('Could not find the built Music Assistant .exe in src-tauri/target/release.');

copyFileSync(exe, join(folder, 'MusicAssistant.exe'));
copyFileSync(resolve('README.md'), join(folder, 'README.md'));
copyFileSync(resolve('LICENSE'), join(folder, 'LICENSE'));

const zipPath = join(outRoot, 'MusicAssistant-Windows-x64.zip');
rmSync(zipPath, { force: true });
const output = createWriteStream(zipPath);
const archive = archiver('zip', { zlib: { level: 9 } });
archive.pipe(output);
archive.directory(folder, 'MusicAssistant');
await archive.finalize();
await new Promise((resolvePromise, reject) => {
  output.on('close', resolvePromise);
  output.on('error', reject);
});
console.log(`Portable package: ${zipPath}`);
