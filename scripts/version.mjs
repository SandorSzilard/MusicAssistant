import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function calculateNextVersion(currentVersion, bump) {
  const match = SEMVER_PATTERN.exec(currentVersion);
  if (!match) {
    throw new Error(`Unsupported canonical version "${currentVersion}". Expected stable MAJOR.MINOR.PATCH.`);
  }
  if (!['patch', 'minor', 'major'].includes(bump)) {
    throw new Error(`Invalid version bump "${bump}". Choose patch, minor, or major.`);
  }

  let [major, minor, patch] = match.slice(1).map(Number);
  if (bump === 'major') {
    major++;
    minor = 0;
    patch = 0;
  } else if (bump === 'minor') {
    minor++;
    patch = 0;
  } else {
    patch++;
  }

  return `${major}.${minor}.${patch}`;
}

function replaceCargoPackageVersion(content, version, path) {
  const packageStart = content.indexOf('[package]');
  if (packageStart < 0) {
    throw new Error(`${path} is missing the [package] section.`);
  }
  const nextSection = content.indexOf('\n[', packageStart + '[package]'.length);
  const sectionEnd = nextSection < 0 ? content.length : nextSection;
  const packageSection = content.slice(packageStart, sectionEnd);
  const versionLine = /^version\s*=\s*"([^"]+)"\s*$/m;
  if (!versionLine.test(packageSection)) {
    throw new Error(`${path} is missing the package version field.`);
  }
  return content.slice(0, packageStart) +
    packageSection.replace(versionLine, `version = "${version}"`) +
    content.slice(sectionEnd);
}

function replaceCargoLockPackageVersion(content, currentVersion, nextVersion) {
  const rootPackage = /\[\[package\]\]\r?\nname = "music-assistant"\r?\nversion = "([^"]+)"/g;
  const matches = [...content.matchAll(rootPackage)];
  if (matches.length !== 1) {
    throw new Error(`Cargo.lock must contain exactly one music-assistant package entry; found ${matches.length}.`);
  }
  if (matches[0][1] !== currentVersion) {
    throw new Error(`Cargo.lock version ${matches[0][1]} does not match canonical package version ${currentVersion}.`);
  }
  const lineEnding = content.includes('\r\n') ? '\r\n' : '\n';
  return content.replace(rootPackage, `[[package]]${lineEnding}name = "music-assistant"${lineEnding}version = "${nextVersion}"`);
}

export function synchronizeVersion(rootDirectory, bump) {
  const root = resolve(rootDirectory);
  const packagePath = resolve(root, 'package.json');
  const packageLockPath = resolve(root, 'package-lock.json');
  const tauriPath = resolve(root, 'src-tauri/tauri.conf.json');
  const cargoPath = resolve(root, 'src-tauri/Cargo.toml');
  const cargoLockPath = resolve(root, 'src-tauri/Cargo.lock');

  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const packageLock = JSON.parse(readFileSync(packageLockPath, 'utf8'));
  const tauriConfig = JSON.parse(readFileSync(tauriPath, 'utf8'));
  const cargoToml = readFileSync(cargoPath, 'utf8');
  const cargoLock = readFileSync(cargoLockPath, 'utf8');
  const currentVersion = packageJson.version;
  const nextVersion = calculateNextVersion(currentVersion, bump);

  if (packageLock.version !== currentVersion || packageLock.packages?.['']?.version !== currentVersion) {
    throw new Error('package-lock.json root version metadata does not match package.json.');
  }
  if (tauriConfig.version !== currentVersion) {
    throw new Error('tauri.conf.json version does not match package.json.');
  }

  const cargoPackageVersion = cargoToml
    .split(/^\[package\]\s*$/m)[1]
    ?.split(/^\[/m)[0];
  if (!cargoPackageVersion || !new RegExp(`^version\\s*=\\s*"${currentVersion.replaceAll('.', '\\.')}"\\s*$`, 'm').test(cargoPackageVersion)) {
    throw new Error('Cargo.toml package version does not match package.json.');
  }

  const updatedCargoToml = replaceCargoPackageVersion(cargoToml, nextVersion, cargoPath);
  const updatedCargoLock = replaceCargoLockPackageVersion(cargoLock, currentVersion, nextVersion);
  packageJson.version = nextVersion;
  packageLock.version = nextVersion;
  packageLock.packages[''].version = nextVersion;
  tauriConfig.version = nextVersion;

  writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  writeFileSync(packageLockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
  writeFileSync(tauriPath, `${JSON.stringify(tauriConfig, null, 2)}\n`);
  writeFileSync(cargoPath, updatedCargoToml);
  writeFileSync(cargoLockPath, updatedCargoLock);

  return nextVersion;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const bump = process.argv[2];
  if (!bump) {
    throw new Error('Usage: node scripts/version.mjs <patch|minor|major>');
  }
  console.log(synchronizeVersion(process.cwd(), bump));
}
