import { execSync } from 'node:child_process';

function command(cmd) {
  try {
    return execSync(cmd, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true
    }).trim();
  } catch {
    return null;
  }
}

const node = process.versions.node;
const npm = command('npm --version');
const rustc = command('rustc --version');
const cargo = command('cargo --version');

console.log(`Node:  ${node}`);
console.log(`npm:   ${npm ?? 'NOT FOUND'}`);
console.log(`rustc: ${rustc ?? 'NOT FOUND'}`);
console.log(`cargo: ${cargo ?? 'NOT FOUND'}`);

const [major, minor] = node.split('.').map(Number);

if (major < 20 || (major === 20 && minor < 19)) {
  console.error(
    'Node.js 20.19+ is required. Node 22 LTS or newer is recommended.'
  );
  process.exitCode = 1;
}

if (!npm) {
  console.error('npm was not found.');
  process.exitCode = 1;
}

if (!rustc || !cargo) {
  console.error(
    'Rust/Cargo is required for the Tauri backend. Install stable Rust using rustup.'
  );
  process.exitCode = 1;
}