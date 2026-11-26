import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

function run(command) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    }).trim();
  } catch (error) {
    return `ERROR: ${error.message}`;
  }
}

console.log('Music Assistant development doctor');
console.log('=================================');

console.log(`OS:          ${process.platform} ${process.arch}`);
console.log(`Node:        ${process.version}`);
console.log(`npm:         ${run('npm --version')}`);
console.log(`Rust:        ${run('rustc --version')}`);
console.log(`Cargo:       ${run('cargo --version')}`);

console.log(
  `Tauri CLI:   ${
    existsSync(join('node_modules', '@tauri-apps', 'cli'))
      ? 'installed'
      : 'not installed'
  }`
);

console.log(
  `Essentia.js: ${
    existsSync(join('node_modules', 'essentia.js'))
      ? 'installed'
      : 'not installed'
  }`
);

console.log(
  `Signalsmith: ${
    existsSync(join('node_modules', 'signalsmith-stretch'))
      ? 'installed'
      : 'not installed'
  }`
);

console.log('');
console.log('Windows requirements:');
console.log('- Rust stable MSVC toolchain');
console.log('- Visual Studio Desktop development with C++');
console.log('- Microsoft Edge WebView2');