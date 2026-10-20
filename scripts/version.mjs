#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const files = {
  packageJson: join(root, "package.json"),
  packageLock: join(root, "package-lock.json"),
  tauriConf: join(root, "src-tauri", "tauri.conf.json"),
  cargoToml: join(root, "src-tauri", "Cargo.toml"),
  cargoLock: join(root, "src-tauri", "Cargo.lock"),
  changelog: join(root, "CHANGELOG.md"),
};

const semver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, content) {
  writeFileSync(path, content);
}

function packageJsonVersion() {
  return JSON.parse(read(files.packageJson)).version;
}

function packageLockVersion() {
  const lock = JSON.parse(read(files.packageLock));
  const rootVersion = lock.version;
  const packageVersion = lock.packages?.[""]?.version;
  if (rootVersion !== packageVersion) {
    throw new Error(
      `package-lock.json is inconsistent: version=${rootVersion}, packages[""].version=${packageVersion}`,
    );
  }
  return rootVersion;
}

function tauriVersion() {
  return JSON.parse(read(files.tauriConf)).version;
}

function cargoVersion() {
  const match = read(files.cargoToml).match(
    /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
  );
  if (!match) throw new Error("Could not find [package] version in Cargo.toml");
  return read(files.cargoToml).match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
}

function cargoLockVersion() {
  const match = read(files.cargoLock).match(
    /\[\[package\]\]\r?\nname = "chilldb"\r?\nversion = "([^"]+)"/,
  );
  if (!match) throw new Error('Could not find package "chilldb" in Cargo.lock');
  return match[1];
}

function changelogSection(version) {
  const text = read(files.changelog);
  const marker = `## [${version}]`;
  const start = text.indexOf(marker);
  if (start === -1) return null;
  const rest = text.slice(start + marker.length);
  const next = rest.indexOf("\n## [");
  return next === -1 ? rest : rest.slice(0, next);
}

function report(errors) {
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exit(1);
  }
}

function check(tag) {
  const versions = {
    "package.json": packageJsonVersion(),
    "package-lock.json": packageLockVersion(),
    "src-tauri/tauri.conf.json": tauriVersion(),
    "src-tauri/Cargo.toml": cargoVersion(),
    "src-tauri/Cargo.lock": cargoLockVersion(),
  };

  const errors = [];
  const unique = new Set(Object.values(versions));
  if (unique.size !== 1) {
    for (const [file, version] of Object.entries(versions)) {
      errors.push(`${file} has version ${version}`);
    }
    errors.push("All version fields must match. Run: npm run version:set -- X.Y.Z");
  }

  const version = versions["package.json"];
  const section = changelogSection(version);
  if (section === null) {
    errors.push(`CHANGELOG.md has no "## [${version}]" section`);
  } else if (section.includes("TODO:")) {
    errors.push(
      `CHANGELOG.md still contains TODO for ${version}. Describe the release before tagging.`,
    );
  }

  if (tag && tag.startsWith("v") && tag !== `v${version}`) {
    errors.push(`Tag ${tag} does not match version v${version}`);
  }

  report(errors);
  console.log(`Version check passed: ${version}`);
}

function set(version) {
  if (!version || !semver.test(version)) {
    console.error("Usage: node scripts/version.mjs set X.Y.Z");
    console.error(`Invalid semantic version: ${version ?? "(missing)"}`);
    process.exit(1);
  }

  const pkg = JSON.parse(read(files.packageJson));
  pkg.version = version;
  write(files.packageJson, `${JSON.stringify(pkg, null, 2)}\n`);

  const lock = JSON.parse(read(files.packageLock));
  lock.version = version;
  if (lock.packages?.[""]) lock.packages[""].version = version;
  write(files.packageLock, `${JSON.stringify(lock, null, 2)}\n`);

  const tauri = JSON.parse(read(files.tauriConf));
  tauri.version = version;
  write(files.tauriConf, `${JSON.stringify(tauri, null, 2)}\n`);

  let cargo = read(files.cargoToml);
  cargo = cargo.replace(
    /(\[package\][\s\S]*?^version\s*=\s*")[^"]+(")/m,
    `$1${version}$2`,
  );
  write(files.cargoToml, cargo);

  let cargoLock = read(files.cargoLock);
  cargoLock = cargoLock.replace(
    /(\[\[package\]\]\r?\nname = "chilldb"\r?\nversion = ")[^"]+(")/,
    `$1${version}$2`,
  );
  write(files.cargoLock, cargoLock);

  let changelog = read(files.changelog);
  if (!changelog.includes(`## [${version}]`)) {
    const date = new Date().toISOString().slice(0, 10);
    const section = `## [${version}] - ${date}\n\n### Changed\n- TODO: describe the user-visible changes in this release.\n`;
    const unreleased = changelog.indexOf("## [Unreleased]");
    if (unreleased !== -1) {
      const lineEnd = changelog.indexOf("\n", unreleased);
      changelog = `${changelog.slice(0, lineEnd + 1)}\n${section}${changelog.slice(lineEnd + 1)}`;
    } else {
      changelog = `${changelog.trimEnd()}\n\n${section}`;
    }
    write(files.changelog, changelog);
    console.log(`Added CHANGELOG.md section for ${version}. Replace the TODO before releasing.`);
  }

  console.log(`Version set to ${version} in all manifests.`);
}

const [command, argument] = process.argv.slice(2);

if (command === "check") {
  const equals = argument?.startsWith("--tag=");
  const tag = equals
    ? argument.slice("--tag=".length)
    : argument === "--tag"
      ? process.argv[4]
      : undefined;
  check(tag);
} else if (command === "set") {
  set(argument);
} else {
  console.error("Usage:");
  console.error("  node scripts/version.mjs check [--tag vX.Y.Z]");
  console.error("  node scripts/version.mjs set X.Y.Z");
  process.exit(1);
}
