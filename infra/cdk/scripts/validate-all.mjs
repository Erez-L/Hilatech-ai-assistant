// Synthesises every environment (with cdk-nag enabled) and fails on the first error. Never deploys.
// Uses a throw-away output directory per env so templates do not overwrite each other.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const envs = ['dev', 'staging', 'prod'];
let failed = false;
for (const env of envs) {
  const out = mkdtempSync(join(tmpdir(), `hilatech-cdk-${env}-`));
  const result = spawnSync(
    'npx',
    [
      'cdk',
      'synth',
      '-c',
      `env=${env}`,
      '-c',
      'alarmEmail=ci@example.com',
      '--quiet',
      '--output',
      out,
    ],
    { stdio: 'inherit', env: { ...process.env, CDK_DISABLE_VERSION_CHECK: '1' } },
  );
  rmSync(out, { recursive: true, force: true });
  console.log(`cdk synth ${env}: ${result.status === 0 ? 'OK' : 'FAILED'}`);
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
