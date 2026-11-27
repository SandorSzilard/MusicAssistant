import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync
} from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function releaseTarget(platform, architecture) {
  if (platform === 'win32' && architecture === 'x64') {
    return {
      os: 'Windows',
      architecture,
      bundle: null,
      bundleDirectory: null,
      binary: 'music-assistant.exe',
      artifactExtension: '.zip',
      archive: 'windows'
    };
  }
  if (platform === 'linux' && architecture === 'x64') {
    return {
      os: 'Linux',
      architecture,
      bundle: 'appimage',
      bundleDirectory: 'appimage',
      candidateExtension: '.AppImage',
      artifactExtension: '.AppImage',
      archive: null
    };
  }
  if (platform === 'darwin' && (architecture === 'x64' || architecture === 'arm64')) {
    return {
      os: 'macOS',
      architecture,
      bundle: 'app',
      bundleDirectory: 'macos',
      candidateExtension: '.app',
      artifactExtension: '.zip',
      archive: 'macos'
    };
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

function runCommand(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}.`);
  }
}

function powershellLiteral(value) {
  return `'${value.replace(/'/g, "''")}'`;
}

function createWindowsArchive(sourceFile, outputFile) {
  const stagingDirectory = mkdtempSync(join(tmpdir(), 'music-assistant-portable-'));
  try {
    const stagedExecutable = join(stagingDirectory, 'MusicAssistant.exe');
    copyFileSync(sourceFile, stagedExecutable);
    const command = [
      '$ErrorActionPreference = \'Stop\';',
      'Compress-Archive',
      `-LiteralPath ${powershellLiteral(stagedExecutable)}`,
      `-DestinationPath ${powershellLiteral(outputFile)}`,
      '-CompressionLevel Optimal',
      '-Force'
    ].join(' ');
    runCommand('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command]);
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
}

function createMacArchive(appBundle, outputFile) {
  runCommand('ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appBundle, outputFile]);
}

const args = parseArguments(process.argv.slice(2));
const target = args.target ? targetIdentity(args.target) : { platform: process.platform, architecture: process.arch };
const release = releaseTarget(target.platform, target.architecture);
const root = process.cwd();
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const version = packageJson.version;
const artifactName = `MusicAssistant-${version}-${release.os}-${release.architecture}${release.artifactExtension}`;
const targetDirectory = args.target
  ? resolve(root, 'src-tauri', 'target', args.target, 'release')
  : resolve(root, 'src-tauri', 'target', 'release');
const inputDirectory = release.bundleDirectory
  ? join(targetDirectory, 'bundle', release.bundleDirectory)
  : targetDirectory;
const expectedInput = release.binary ? join(targetDirectory, release.binary) : inputDirectory;
const outputDirectory = resolve(root, 'dist', 'releases');
const outputFile = join(outputDirectory, artifactName);

if (args.dryRun) {
  console.log(release.bundle ? `Tauri bundle: ${release.bundle}` : 'Tauri build: executable only (--no-bundle)');
  console.log(`Expected input: ${expectedInput}`);
  console.log(`Expected artifact: ${outputFile}`);
  if (release.archive === 'windows') {
    console.log('Archive contents: MusicAssistant.exe');
  }
  process.exit(0);
}

if (!args.skipBuild) {
  const tauriCli = resolve(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js');
  if (!existsSync(tauriCli)) {
    throw new Error('Tauri CLI is not installed. Run npm ci before packaging.');
  }
  const buildArguments = ['build', '--ci'];
  if (release.bundle) {
    buildArguments.push('--bundles', release.bundle);
  } else {
    buildArguments.push('--no-bundle');
  }
  if (args.target) {
    buildArguments.push('--target', args.target);
  }
  runCommand(process.execPath, [tauriCli, ...buildArguments]);
}

if (!existsSync(inputDirectory)) {
  throw new Error(`Expected build output directory not found: ${inputDirectory}`);
}

let inputFile = expectedInput;
if (!release.binary) {
  const candidates = readdirSync(inputDirectory, { withFileTypes: true })
    .filter((entry) => release.bundle === 'app'
      ? entry.isDirectory() && entry.name.toLowerCase().endsWith(release.candidateExtension.toLowerCase())
      : entry.isFile() && entry.name.toLowerCase().endsWith(release.candidateExtension.toLowerCase()))
    .map((entry) => join(inputDirectory, entry.name));
  if (candidates.length !== 1) {
    throw new Error(`Expected exactly one ${release.bundle} output in ${inputDirectory}; found ${candidates.length}.`);
  }
  inputFile = candidates[0];
}

if (!existsSync(inputFile)) {
  throw new Error(`Expected build output not found: ${inputFile}`);
}

mkdirSync(outputDirectory, { recursive: true });
rmSync(outputFile, { force: true });
if (release.archive === 'windows') {
  createWindowsArchive(inputFile, outputFile);
} else if (release.archive === 'macos') {
  createMacArchive(inputFile, outputFile);
} else {
  copyFileSync(inputFile, outputFile);
  chmodSync(outputFile, 0o755);
}
if (!existsSync(outputFile)) {
  throw new Error(`Portable release artifact was not created: ${outputFile}`);
}
console.log(`Release artifact: ${basename(outputFile)}`);
