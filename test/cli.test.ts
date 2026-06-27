import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, afterEach } from 'vitest';
import { PROGRAM_NAME, VERSION, run } from '../src/cli.js';
import { checkDependencies, readSddcIgnore, updateDependencyVersion } from '../src/checker.js';

// ─── CLI flag tests ────────────────────────────────────────────────────────────

describe('run — flags', () => {
  it('prints help with --help and exits 0', () => {
    const result = run(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stderr).toBeUndefined();
  });

  it('prints help with -h', () => {
    const result = run(['-h']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('prints the version with --version', () => {
    const result = run(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${PROGRAM_NAME} ${VERSION}\n`);
  });

  it('prints the version with -v', () => {
    const result = run(['-v']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(VERSION);
  });

  it('errors on an unknown option', () => {
    const result = run(['--nope']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBeDefined();
  });
});

// ─── Fixture helpers ───────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sddc-test-'));
  tmpDirs.push(dir);
  return dir;
}

function writePackageJson(dir: string, content: object): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(content, null, 2));
}

afterEach(() => {
  for (const dir of tmpDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ─── checkDependencies unit tests ─────────────────────────────────────────────

describe('checkDependencies', () => {
  it('returns empty array when no package.json files exist', () => {
    const dir = makeTmpDir();
    expect(checkDependencies(dir)).toEqual([]);
  });

  it('collects dependencies from a single package.json', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      dependencies: { react: '^18.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    });

    const reports = checkDependencies(dir);
    const names = reports.map((r) => r.name);
    expect(names).toContain('react');
    expect(names).toContain('typescript');
  });

  it('reports a single version when all package.json files agree', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { lodash: '^4.17.21' } });
    writePackageJson(join(dir, 'packages', 'app'), {
      dependencies: { lodash: '^4.17.21' },
    });

    const reports = checkDependencies(dir);
    const lodash = reports.find((r) => r.name === 'lodash');
    expect(lodash?.versions).toEqual(['^4.17.21']);
  });

  it('flags a conflict when two package.json files disagree', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { lodash: '^4.17.21' } });
    writePackageJson(join(dir, 'packages', 'app'), {
      dependencies: { lodash: '^3.10.1' },
    });

    const reports = checkDependencies(dir);
    const lodash = reports.find((r) => r.name === 'lodash');
    expect(lodash?.versions).toHaveLength(2);
    expect(lodash?.versions).toContain('^4.17.21');
    expect(lodash?.versions).toContain('^3.10.1');
  });

  it('ignores node_modules directories', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    // This should be ignored
    writePackageJson(join(dir, 'node_modules', 'some-pkg'), {
      dependencies: { react: '^17.0.0' },
    });

    const reports = checkDependencies(dir);
    const react = reports.find((r) => r.name === 'react');
    expect(react?.versions).toEqual(['^18.0.0']);
  });

  it('scans nested workspace packages', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      workspaces: ['packages/*'],
      dependencies: { typescript: '^5.4.0' },
    });
    writePackageJson(join(dir, 'packages', 'lib'), {
      dependencies: { typescript: '^5.4.0' },
    });
    writePackageJson(join(dir, 'packages', 'app'), {
      dependencies: { typescript: '^5.0.0' },
    });

    const reports = checkDependencies(dir);
    const ts = reports.find((r) => r.name === 'typescript');
    expect(ts?.versions).toHaveLength(2);
  });

  it('does not double-count a dep listed in both dependencies and devDependencies', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      dependencies: { typescript: '^5.0.0' },
      devDependencies: { typescript: '^5.0.0' },
    });

    const reports = checkDependencies(dir);
    const ts = reports.find((r) => r.name === 'typescript');
    // Same file, same version — should appear only once
    expect(ts?.usages).toHaveLength(1);
  });

  it('treats versions as opaque strings (no semver resolution)', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { foo: '^1.0.0' } });
    writePackageJson(join(dir, 'sub'), { dependencies: { foo: '1.0.0' } });

    const reports = checkDependencies(dir);
    const foo = reports.find((r) => r.name === 'foo');
    // '^1.0.0' ≠ '1.0.0' by string comparison
    expect(foo?.versions).toHaveLength(2);
  });

  it('results are sorted alphabetically by package name', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      dependencies: { zod: '^3.0.0', axios: '^1.0.0', react: '^18.0.0' },
    });

    const reports = checkDependencies(dir);
    const names = reports.map((r) => r.name);
    expect(names).toEqual([...names].sort());
  });
});

// ─── run integration tests ─────────────────────────────────────────────────────

describe('run — scanning', () => {
  it('exits 0 and shows no-conflict summary when all versions match', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'packages', 'app'), {
      dependencies: { react: '^18.0.0' },
    });

    const result = run([dir, '--no-color']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('all consistent');
    expect(result.stdout).toContain('✓');
  });

  it('exits 1 and shows conflict when versions differ', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'packages', 'app'), {
      dependencies: { react: '^17.0.0' },
    });

    const result = run([dir, '--no-color']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('✗');
    expect(result.stdout).toContain('conflicts');
  });

  it('shows each conflicting package.json path and its version', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { typescript: '^5.0.0' } });
    writePackageJson(join(dir, 'sub'), { dependencies: { typescript: '^4.9.0' } });

    const result = run([dir, '--no-color']);
    expect(result.stdout).toContain('package.json');
    expect(result.stdout).toContain('^5.0.0');
    expect(result.stdout).toContain('^4.9.0');
  });

  it('uses cwd parameter as default directory when no positional given', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });

    const result = run(['--no-color'], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('react');
  });
});

// ─── --exclude option ──────────────────────────────────────────────────────────

describe('--exclude / -e', () => {
  it('excludes a directory by exact name', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'legacy'), { dependencies: { react: '^16.0.0' } });

    // Without exclude: conflict
    expect(checkDependencies(dir).find((r) => r.name === 'react')?.versions).toHaveLength(2);

    // With exclude: no conflict
    const reports = checkDependencies(dir, ['legacy']);
    expect(reports.find((r) => r.name === 'react')?.versions).toHaveLength(1);
  });

  it('excludes a directory by relative path', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { lodash: '^4.0.0' } });
    writePackageJson(join(dir, 'packages', 'internal'), {
      dependencies: { lodash: '^3.0.0' },
    });

    const reports = checkDependencies(dir, ['packages/internal']);
    expect(reports.find((r) => r.name === 'lodash')?.versions).toHaveLength(1);
  });

  it('excludes directories matching a glob pattern', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { zod: '^3.0.0' } });
    writePackageJson(join(dir, 'packages', 'app-legacy'), {
      dependencies: { zod: '^2.0.0' },
    });
    writePackageJson(join(dir, 'packages', 'lib-legacy'), {
      dependencies: { zod: '^1.0.0' },
    });

    const reports = checkDependencies(dir, ['*-legacy']);
    expect(reports.find((r) => r.name === 'zod')?.versions).toHaveLength(1);
  });

  it('accepts multiple exclude patterns via CLI', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'old'), { dependencies: { react: '^17.0.0' } });
    writePackageJson(join(dir, 'legacy'), { dependencies: { react: '^16.0.0' } });

    const result = run([dir, '-e', 'old', '-e', 'legacy', '--no-color']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('all consistent');
  });
});

// ─── .sddcignore ──────────────────────────────────────────────────────────────

describe('readSddcIgnore', () => {
  it('returns empty array when no .sddcignore exists', () => {
    const dir = makeTmpDir();
    expect(readSddcIgnore(dir)).toEqual([]);
  });

  it('reads patterns from .sddcignore, skipping comments and blank lines', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, '.sddcignore'),
      '# comment\n\ndist\nbuild\n  \n*.generated\n',
    );
    expect(readSddcIgnore(dir)).toEqual(['dist', 'build', '*.generated']);
  });

  it('applies root .sddcignore patterns during scan', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, '.sddcignore'), 'legacy\n');
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'legacy'), { dependencies: { react: '^16.0.0' } });

    const reports = checkDependencies(dir);
    expect(reports.find((r) => r.name === 'react')?.versions).toHaveLength(1);
  });

  it('applies .sddcignore from a subdirectory to that subtree only', () => {
    const dir = makeTmpDir();
    // packages/.sddcignore excludes "internal" inside packages/
    mkdirSync(join(dir, 'packages'), { recursive: true });
    writeFileSync(join(dir, 'packages', '.sddcignore'), 'internal\n');
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'packages', 'app'), { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'packages', 'internal'), {
      dependencies: { react: '^16.0.0' },
    });

    // packages/internal should be excluded → no conflict
    const reports = checkDependencies(dir);
    expect(reports.find((r) => r.name === 'react')?.versions).toHaveLength(1);
  });

  it('does not apply a subdirectory .sddcignore to sibling directories', () => {
    const dir = makeTmpDir();
    // packages/.sddcignore excludes "internal", but other/ is a sibling of packages/
    mkdirSync(join(dir, 'packages'), { recursive: true });
    writeFileSync(join(dir, 'packages', '.sddcignore'), 'internal\n');
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    // "internal" as a sibling of packages/ — should NOT be excluded
    writePackageJson(join(dir, 'internal'), { dependencies: { react: '^16.0.0' } });

    const reports = checkDependencies(dir);
    expect(reports.find((r) => r.name === 'react')?.versions).toHaveLength(2);
  });

  it('accumulates patterns from root and nested .sddcignore files', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, '.sddcignore'), 'legacy\n');
    mkdirSync(join(dir, 'packages'), { recursive: true });
    writeFileSync(join(dir, 'packages', '.sddcignore'), 'internal\n');

    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    // excluded by root .sddcignore
    writePackageJson(join(dir, 'legacy'), { dependencies: { react: '^17.0.0' } });
    // excluded by packages/.sddcignore
    writePackageJson(join(dir, 'packages', 'internal'), {
      dependencies: { react: '^16.0.0' },
    });
    writePackageJson(join(dir, 'packages', 'app'), {
      dependencies: { react: '^18.0.0' },
    });

    const reports = checkDependencies(dir);
    expect(reports.find((r) => r.name === 'react')?.versions).toHaveLength(1);
  });
});

// ─── --errors-only / -o ───────────────────────────────────────────────────────

describe('--errors-only / -o', () => {
  it('hides consistent packages but still counts them in the summary', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      dependencies: { react: '^18.0.0', typescript: '^5.0.0' },
    });
    writePackageJson(join(dir, 'sub'), {
      dependencies: { react: '^17.0.0', typescript: '^5.0.0' },
    });

    const result = run([dir, '--errors-only', '--no-color']);
    expect(result.code).toBe(1);
    // typescript (consistent) must not appear in the output
    expect(result.stdout).not.toContain('✓');
    // react (conflict) must appear
    expect(result.stdout).toContain('✗');
    // summary must still reflect total package count
    expect(result.stdout).toContain('2 packages checked');
  });

  it('shows only the summary when there are no conflicts', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });

    const result = run([dir, '-o', '--no-color']);
    expect(result.code).toBe(0);
    expect(result.stdout).not.toContain('✓');
    expect(result.stdout).toContain('all consistent');
  });
});

// ─── updateDependencyVersion ───────────────────────────────────────────────────

describe('updateDependencyVersion', () => {
  it('updates a version in dependencies', () => {
    const dir = makeTmpDir();
    const file = join(dir, 'package.json');
    writeFileSync(file, JSON.stringify({ dependencies: { react: '^17.0.0' } }, null, 2));

    updateDependencyVersion(file, 'react', '^18.0.0');

    const updated = JSON.parse(readFileSync(file, 'utf-8')) as {
      dependencies: Record<string, string>;
    };
    expect(updated.dependencies['react']).toBe('^18.0.0');
  });

  it('updates across all dependency fields', () => {
    const dir = makeTmpDir();
    const file = join(dir, 'package.json');
    writeFileSync(
      file,
      JSON.stringify(
        { dependencies: { ts: '^4.0.0' }, devDependencies: { ts: '^4.0.0' } },
        null,
        2,
      ),
    );

    updateDependencyVersion(file, 'ts', '^5.0.0');

    const updated = JSON.parse(readFileSync(file, 'utf-8')) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    expect(updated.dependencies['ts']).toBe('^5.0.0');
    expect(updated.devDependencies['ts']).toBe('^5.0.0');
  });

  it('preserves other fields in the package.json', () => {
    const dir = makeTmpDir();
    const file = join(dir, 'package.json');
    writeFileSync(
      file,
      JSON.stringify({ name: 'my-pkg', version: '1.0.0', dependencies: { react: '^17.0.0' } }, null, 2),
    );

    updateDependencyVersion(file, 'react', '^18.0.0');

    const updated = JSON.parse(readFileSync(file, 'utf-8')) as {
      name: string;
      version: string;
    };
    expect(updated.name).toBe('my-pkg');
    expect(updated.version).toBe('1.0.0');
  });

  it('does nothing when the package is not present', () => {
    const dir = makeTmpDir();
    const file = join(dir, 'package.json');
    const original = JSON.stringify({ dependencies: { lodash: '^4.0.0' } }, null, 2);
    writeFileSync(file, original);

    updateDependencyVersion(file, 'react', '^18.0.0');

    expect(readFileSync(file, 'utf-8')).toBe(original);
  });
});
