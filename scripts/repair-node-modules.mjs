import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * Repairs the workspace node_modules layout that npm 11/12 keeps breaking:
 *
 * npm's incremental `npm install` reify path has a bug in this repo: it
 * alternately prunes one of two groups from the root node_modules even
 * though both are declared and in the lockfile:
 *   - Group A: the @react-native/* tooling scope (typescript-config,
 *     babel-preset, metro-config)
 *   - Group B: @babel/plugin-proposal-decorators
 * After any `npm install`, exactly one group is missing. The flip is stable
 * (targeted installs just ping-pong), but a clean `npm ci --ignore-scripts`
 * (which reinstalls from the lockfile with no diff computation) produces a
 * correct, complete tree.
 *
 * 1. If either group is missing, run a clean `npm ci --ignore-scripts`.
 * 2. Every `npm install` also prunes the two junctions inside
 *    apps/mobile/node_modules that point back to the hoisted react-native /
 *    react-native-video (gradle autolinking + Metro depend on them).
 *    Re-create them after the clean install (npm ci wipes node_modules).
 */
const root = process.cwd();
const mobile = join(root, 'apps', 'mobile', 'node_modules');
const critical = [
  join(root, 'node_modules', '@react-native', 'typescript-config', 'tsconfig.json'),
  join(root, 'node_modules', '@react-native', 'babel-preset', 'index.js'),
  join(root, 'node_modules', '@react-native', 'metro-config', 'index.js'),
  join(root, 'node_modules', '@babel', 'plugin-proposal-decorators', 'package.json'),
];

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (critical.some((p) => !existsSync(p))) {
  console.log('[repair] node_modules incomplete; running clean `npm ci --ignore-scripts`...');
  const result = spawnSync(npmCmd, ['ci', '--ignore-scripts'], { stdio: 'inherit', cwd: root });
  if (result.status !== 0) {
    console.error('[repair] `npm ci` failed; node_modules may still be incomplete');
  }
}

for (const name of ['react-native', 'react-native-video']) {
  const linkPath = join(mobile, name);
  if (existsSync(linkPath)) continue;
  const result = spawnSync('cmd', ['/c', 'mklink', '/J', linkPath, join(root, 'node_modules', name)], {
    stdio: 'ignore',
  });
  if (result.status === 0) {
    console.log(`[repair] recreated junction ${linkPath}`);
  } else {
    console.error(`[repair] failed to create junction ${linkPath}`);
  }
}

const rnScope = join(mobile, '@react-native');
if (!existsSync(rnScope)) {
  const result = spawnSync(
    'cmd',
    ['/c', 'mklink', '/J', rnScope, join(root, 'node_modules', '@react-native')],
    { stdio: 'ignore' },
  );
  if (result.status === 0) {
    console.log(`[repair] recreated junction ${rnScope}`);
  } else {
    console.error(`[repair] failed to create junction ${rnScope}`);
  }
}
