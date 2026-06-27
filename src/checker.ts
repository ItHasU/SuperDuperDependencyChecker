import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join, relative, sep } from 'node:path';

export interface DependencyUsage {
  version: string;
  packageJsonPath: string;
}

export interface DependencyReport {
  name: string;
  versions: string[];
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

function globToRegex(pattern: string): RegExp {
  // Escape all regex special chars except *, then replace * with [^/]*
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  return new RegExp('^' + escaped.replace(/\*/g, '[^/]*') + '$');
}

function shouldExcludeDir(
  absolutePath: string,
  rootDir: string,
  patterns: readonly string[],
): boolean {
  if (patterns.length === 0) return false;
  // Normalise to forward slashes so patterns work cross-platform
  const relPath = relative(rootDir, absolutePath).split(sep).join('/');
  const dirName = basename(absolutePath);
  for (const pattern of patterns) {
    const regex = globToRegex(pattern);
    if (regex.test(dirName) || regex.test(relPath)) return true;
  }
  return false;
}

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

function findPackageJsonFiles(
  dir: string,
  activePatterns: readonly string[],
  rootDir: string,
  results: string[] = [],
): string[] {
  // Merge any .sddcignore found in the current directory into the active patterns.
  // These additional patterns then apply to all subdirectories from here down.
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
