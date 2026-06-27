import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

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

function findPackageJsonFiles(dir: string, results: string[] = []): string[] {
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
      findPackageJsonFiles(fullPath, results);
    } else if (entry === 'package.json') {
      results.push(fullPath);
    }
  }
  return results;
}

export function checkDependencies(rootDir: string): DependencyReport[] {
  const packageJsonFiles = findPackageJsonFiles(rootDir);
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
        // Skip if already recorded for this file (same dep in multiple fields)
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
