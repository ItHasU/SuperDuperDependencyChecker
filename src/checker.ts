import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

/** A single occurrence of a package at a specific version inside one package.json. */
export interface DependencyUsage {
  /** The version string exactly as written in the package.json file. */
  version: string;
  /** Absolute path to the package.json file that declares this version. */
  packageJsonPath: string;
}

/**
 * Aggregated information about one npm package across all scanned
 * package.json files.
 */
export interface DependencyReport {
  /** npm package name, e.g. `"typescript"`. */
  name: string;
  /**
   * Distinct version strings found for this package.  A length > 1 indicates
   * a version conflict.  Comparison is purely lexicographic — no semver
   * resolution is performed.
   */
  versions: string[];
  /** Every individual occurrence (file + version) contributing to this report. */
  usages: DependencyUsage[];
}

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const DEP_FIELDS: ReadonlyArray<keyof PackageJson> = [
  'dependencies',
  'devDependencies',
  'peerDependencies',
  'optionalDependencies',
];

/**
 * Converts a simple glob pattern (supporting only `*` as a wildcard within a
 * single path segment) into a RegExp anchored at both ends.
 */
function globToRegex(pattern: string): RegExp {
  // Escape all regex metacharacters except *, then replace * with [^/]*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*/g, '[^/]*') + '$');
}

/**
 * Returns `true` when `absolutePath` (a directory) should be excluded from
 * the scan given the currently active `patterns`.
 *
 * Each pattern is tested against both:
 * - the directory's base name (e.g. `"dist"`), and
 * - its path relative to `rootDir` normalised with forward slashes
 *   (e.g. `"packages/internal"`).
 */
function shouldExcludeDir(
  absolutePath: string,
  rootDir: string,
  patterns: readonly string[],
): boolean {
  if (patterns.length === 0) return false;
  const relPath = relative(rootDir, absolutePath).split(sep).join('/');
  const dirName = basename(absolutePath);
  for (const pattern of patterns) {
    const regex = globToRegex(pattern);
    if (regex.test(dirName) || regex.test(relPath)) return true;
  }
  return false;
}

/**
 * Reads ignore patterns from a `.sddcignore` file in `rootDir`.
 *
 * The file format is one pattern per line.  Lines that are empty or begin
 * with `#` (after trimming) are ignored.
 *
 * @returns Array of pattern strings, or an empty array when the file does not
 *          exist or cannot be read.
 */
export function readSddcIgnore(rootDir: string): string[] {
  const file = join(rootDir, '.sddcignore');
  if (!existsSync(file)) return [];
  try {
    return readFileSync(file, 'utf-8')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !l.startsWith('#'));
  } catch {
    return [];
  }
}

/**
 * Recursively collects all `package.json` paths under `dir`.
 *
 * `node_modules` and `.git` directories are always skipped.  On entry into
 * each directory the local `.sddcignore` is read and its patterns are merged
 * into `activePatterns` for that directory's subtree only.
 */
function findPackageJsonFiles(
  dir: string,
  activePatterns: readonly string[],
  rootDir: string,
  results: string[] = [],
): string[] {
  const localIgnore = readSddcIgnore(dir);
  const patternsForChildren =
    localIgnore.length > 0 ? [...activePatterns, ...localIgnore] : activePatterns;

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '.git') continue;
    const fullPath = join(dir, entry);
    let isDir: boolean;
    try {
      isDir = statSync(fullPath).isDirectory();
    } catch {
      continue;
    }
    if (isDir) {
      if (!shouldExcludeDir(fullPath, rootDir, patternsForChildren)) {
        findPackageJsonFiles(fullPath, patternsForChildren, rootDir, results);
      }
    } else if (entry === 'package.json') {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * Scans `rootDir` for `package.json` files and collects every dependency
 * version declared across them.
 *
 * Each file is inspected for `dependencies`, `devDependencies`,
 * `peerDependencies`, and `optionalDependencies`.  When the same package
 * appears in multiple fields of the same file, only the first occurrence
 * (in the field order listed above) is counted, preventing spurious
 * self-conflicts.
 *
 * Version comparison is purely lexicographic — no semver resolution is
 * performed, so `"^1.0.0"` and `"1.0.0"` are treated as distinct versions.
 *
 * @param rootDir         Root of the directory tree to scan.
 * @param excludePatterns Additional glob patterns to exclude (on top of any
 *                        `.sddcignore` files found during the scan).
 * @returns               One {@link DependencyReport} per unique package name,
 *                        sorted alphabetically.
 */
export function checkDependencies(
  rootDir: string,
  excludePatterns: readonly string[] = [],
): DependencyReport[] {
  const packageJsonFiles = findPackageJsonFiles(rootDir, excludePatterns, rootDir);
  const depMap = new Map<string, Map<string, string[]>>();

  for (const filePath of packageJsonFiles) {
    let content: PackageJson;
    try {
      content = JSON.parse(readFileSync(filePath, 'utf-8')) as PackageJson;
    } catch {
      continue;
    }

    // Track which package names we've already processed for this file so that
    // the same package appearing in multiple dep fields is only counted once.
    const seen = new Set<string>();

    for (const field of DEP_FIELDS) {
      const deps = content[field];
      if (!deps) continue;

      for (const [name, version] of Object.entries(deps)) {
        if (seen.has(name)) continue;
        seen.add(name);

        let versionMap = depMap.get(name);
        if (!versionMap) {
          versionMap = new Map();
          depMap.set(name, versionMap);
        }

        let paths = versionMap.get(version);
        if (!paths) {
          paths = [];
          versionMap.set(version, paths);
        }
        paths.push(filePath);
      }
    }
  }

  const results: DependencyReport[] = [];
  for (const [name, versionMap] of depMap) {
    const usages: DependencyUsage[] = [];
    for (const [version, paths] of versionMap) {
      for (const path of paths) {
        usages.push({ version, packageJsonPath: path });
      }
    }
    results.push({ name, versions: [...versionMap.keys()], usages });
  }

  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

/**
 * Updates the version of `packageName` inside the given `package.json` file.
 *
 * All dependency fields (`dependencies`, `devDependencies`, `peerDependencies`,
 * `optionalDependencies`) are updated when they reference `packageName`.
 * The file is rewritten preserving the original indentation.  If the package
 * is not present in the file, the function is a no-op.
 *
 * @param filePath    Absolute path to the `package.json` file to modify.
 * @param packageName The npm package name whose version should change.
 * @param newVersion  The new version string to write.
 */
export function updateDependencyVersion(
  filePath: string,
  packageName: string,
  newVersion: string,
): void {
  const content = readFileSync(filePath, 'utf-8');
  const raw = JSON.parse(content) as Record<string, unknown>;

  const indentMatch = content.match(/\n( +)"/);
  const indent = indentMatch?.[1]?.length ?? 2;

  let modified = false;
  for (const field of DEP_FIELDS) {
    const deps = raw[field] as Record<string, string> | undefined;
    if (deps?.[packageName] !== undefined) {
      deps[packageName] = newVersion;
      modified = true;
    }
  }

  if (modified) {
    const newContent =
      JSON.stringify(raw, null, indent) + (content.endsWith('\n') ? '\n' : '');
    writeFileSync(filePath, newContent);
  }
}
