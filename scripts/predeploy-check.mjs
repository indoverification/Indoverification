import { spawnSync } from 'node:child_process';

const checks = [
  ['test:app-registry', 'app registry'],
  ['test:app-request', 'app request isolation'],
  ['test:app-email', 'email isolation'],
  ['test:multi-app-regression', 'multi-app regression'],
  ['test:multi-app-startup', 'startup validation'],
  ['test:db-isolation', 'database isolation'],
];

for (const [script, label] of checks) {
  const result = spawnSync('npm', ['run', script], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) {
    console.error(`Pre-deploy check failed: ${label}`);
    process.exit(result.status || 1);
  }
}

console.log('All pre-deploy checks completed successfully.');
