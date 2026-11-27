import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function releaseTarget(platform, architecture) {
  if (platform === 'win32' && architecture === 'x64') {
    return { os: 'Windows', architecture: 'x64', bundle: 'nsis', extension: '.exe', suffix: '-setup' };
  }
  if (platform === 'linux' && architecture === 'x64') {
    return { os: 'Linux', architecture: 'x64', bundle: 'deb', extension: '.deb', suffix: '' };
  }
  if (platform === 'darwin' && (architecture === 'x64' || architecture === 'arm64')) {
    return { os: 'macOS', architecture, bundle: 'dmg', extension: '.dmg', suffix: '' };
  }
  throw new Error(`Unsupported release host: ${platform}/${architecture}.`);
}

function parseArguments(args) {
  const parsed = { skipBuild: false, target: null, dryRun: false };
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--skip-build') {
      parsed.skipBuild = true;
    } else if (args[index] === '--dry-run') {
      parsed.dryRun = true;
    } else if (args[index] === '--target') {
      const target = args[index + 1];
      if (!target || target.startsWith('--')) {
        throw new Error('--target requires a supported Rust target triple.');
      }
      parsed.target = target;
      index++;
    } else {
      throw new Error(`Unknown argument: ${args[index]}`);
    }
  }
  return parsed;
}

function targetIdentity(targetTriple) {
  const targets = {
    'x86_64-pc-windows-msvc': { platform: 'win32', architecture: 'x64' },
    'x86_64-unknown-linux-gnu': { platform: 'linux', architecture: 'x64' },
    'x86_64-apple-darwin': { platform: 'darwin', architecture: 'x64' },
    'aarch64-apple-darwin': { platform: 'darwin', architecture: 'arm64' }
  };
  if (!targets[targetTriple]) {
    throw new Error(`Unsupported release target: ${targetTriple}.`);
  }
  return targets[targetTriple];
}

const args = parseArguments(process.argv.slice(2));
const target = args.target ? targetIdentity(args.target) : { platform: process.platform, architecture: process.arch };
const release = releaseTarget(target.platform, target.architecture);
const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const canonicalFileName = `MusicAssistant-${version}-${release.os}-${release.architecture}${release.suffix}${release.extension}`;
const targetDirectory = args.target
  ? resolve(root, 'src-tauri', 'target', args.target, 'release')
  : resolve(root, 'src-tauri', 'target', 'release');
const bundleDirectory = join(targetDirectory, 'bundle', release.bundle);
const outputDirectory = resolve(root, 'dist', 'releases');
const outputFile = join(outputDirectory, canonicalFileName);

if (args.dryRun) {
  console.log(`Tauri bundle: ${release.bundle}`);
  console.log(`Expected input: ${bundleDirectory}`);
  console.log(`Expected artifact: ${outputFile}`);
  process.exit(0);
}

if (!args.skipBuild) {
  const tauriCli = resolve(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!existsSync(tauriCli)) {
    throw new Error('Tauri CLI is not installed. Run npm ci before packaging.');
  }
  const buildArguments = ['build', '--ci', '--bundles', release.bundle];
  if (args.target) {
    buildArguments.push('--target', args.target);
  }
  const result = spawnSync(process.execPath, [tauriCli, ...buildArguments], { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

if (!existsSync(bundleDirectory)) {
  throw new Error(`Tauri bundle directory not found: ${bundleDirectory}`);
}

const candidates = readdirSync(bundleDirectory)
  .filter((name) => name.toLowerCase().endsWith(release.extension))
  .map((name) => join(bundleDirectory, name));
if (candidates.length !== 1) {
  throw new Error(`Expected exactly one ${release.bundle} installer in ${bundleDirectory}; found ${candidates.length}.`);
}

mkdirSync(outputDirectory, { recursive: true });
copyFileSync(candidates[0], outputFile);
console.log(`Release artifact: ${basename(outputFile)}`);
