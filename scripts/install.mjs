/**
 * Install this plugin into a DSH profile.
 *
 * Usage:
 *   node scripts/install.mjs [profileDir]
 *
 * Defaults to $DSH_PROFILE_DIR, then ~/.dsh/profiles/desktop. The script links
 * this package into the profile's node_modules (Windows junction), then records
 * it in the profile manifest's dependencies and dsh.profile.bundles. Run pnpm
 * install afterwards if you want the lockfile refreshed.
 */
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_NAME = 'dsh-approval-popup';
const source = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
if (manifest.name !== PACKAGE_NAME) {
  throw new Error(`refusing to install: expected ${PACKAGE_NAME}, found ${manifest.name}`);
}

const profile = resolve(
  process.argv[2] ?? process.env.DSH_PROFILE_DIR ?? join(homedir(), '.dsh', 'profiles', 'desktop')
);
const profileManifestPath = join(profile, 'package.json');
if (!existsSync(profileManifestPath)) {
  throw new Error(`not a DSH profile (missing package.json): ${profile}`);
}

// 1. Link the package where Node and the client-module scanner resolve it.
const nodeModules = join(profile, 'node_modules');
mkdirSync(nodeModules, { recursive: true });
const target = join(nodeModules, PACKAGE_NAME);
if (existsSync(target) || lstatSync(target, { throwIfNoEntry: false }) !== undefined) {
  const stat = lstatSync(target);
  if (!stat.isSymbolicLink()) {
    let installedName;
    try {
      installedName = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).name;
    } catch {
      installedName = undefined;
    }
    if (installedName !== PACKAGE_NAME) {
      throw new Error(`refusing to replace unrelated directory: ${target}`);
    }
    rmSync(target, { recursive: true, force: true });
  } else {
    rmSync(target, { force: true });
  }
}
symlinkSync(source, target, 'junction');
console.log(`linked ${target} -> ${source}`);

// 2. Record the dependency and bundle row, with a one-time manifest backup.
const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8'));
const backup = `${profileManifestPath}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
if (!existsSync(backup)) copyFileSync(profileManifestPath, backup);

profileManifest.dependencies ??= {};
profileManifest.dependencies[PACKAGE_NAME] = `link:${source.replaceAll('\\', '/')}`;

profileManifest.dsh ??= {};
profileManifest.dsh.profile ??= {};
profileManifest.dsh.profile.bundles ??= [];
if (!profileManifest.dsh.profile.bundles.includes(PACKAGE_NAME)) {
  profileManifest.dsh.profile.bundles.push(PACKAGE_NAME);
}

writeFileSync(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`, 'utf8');
console.log(`updated ${profileManifestPath}`);
console.log(`backup: ${backup}`);
console.log('DSH reloads the profile automatically; refresh the Web page to load the new client bundle.');
