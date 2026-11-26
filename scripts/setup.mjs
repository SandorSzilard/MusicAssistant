import { spawnSync } from 'node:child_process';
import './check-env.mjs';

if (process.exitCode) {
  process.exit(process.exitCode);
}

console.log('\nInstalling npm dependencies...');

const result = spawnSync('npm', ['install'], {
  stdio: 'inherit',
  shell: true
});

if (result.error) {
  console.error('\nFailed to start npm install:');
  console.error(result.error);
  process.exit(1);
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}

console.log('\nSetup complete.');
console.log('');
console.log('Next commands:');
console.log('  npm run doctor');
console.log('  npm run dev');