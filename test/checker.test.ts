/**
 * Unit tests for src/checker.ts
 *
 * Covers: directory scanning, exclude patterns, .sddcignore, conflict
 * detection, version deduplication, and the updateDependencyVersion helper.
 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import {
  checkDependencies,
  readSddcIgnore,
  updateDependencyVersion,
} from '../src/checker.js';

// ─── Fixture helpers ───────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sddc-checker-'));
  tmpDirs.push(dir);
  return dir;
}

function writePackageJson(dir: string, content: object): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(content, null, 2));
}

afterEach(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
  tmpDirs = [];
});

// ─── checkDependencies ────────────────────────────────────────────────────────

describe('checkDependencies — scanning', () => {
  it('returns empty array when no package.json files exist', () => {
    expect(checkDependencies(makeTmpDir())).toEqual([]);
  });

  it('collects dependencies from all dep fields in a single file', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      dependencies: { react: '^18.0.0' },
      devDependencies: { typescript: '^5.0.0' },
      peerDependencies: { 'react-dom': '^18.0.0' },
      optionalDependencies: { fsevents: '^2.0.0' },
    });

    const names = checkDependencies(dir).map((r) => r.name);
    expect(names).toContain('react');
    expect(names).toContain('typescript');
    expect(names).toContain('react-dom');
    expect(names).toContain('fsevents');
  });

  it('scans nested workspace packages recursively', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      workspaces: ['packages/*'],
      dependencies: { ts: '^5.4.0' },
    });
    writePackageJson(join(dir, 'packages', 'lib'), {
      dependencies: { ts: '^5.4.0' },
    });
    writePackageJson(join(dir, 'packages', 'app'), {
      dependencies: { ts: '^5.0.0' },
    });

    const ts = checkDependencies(dir).find((r) => r.name === 'ts');
    expect(ts?.versions).toHaveLength(2);
  });

  it('always skips node_modules', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'node_modules', 'some-pkg'), {
      dependencies: { react: '^17.0.0' },
    });

    const react = checkDependencies(dir).find((r) => r.name === 'react');
    expect(react?.versions).toEqual(['^18.0.0']);
  });

  it('reports no conflict when all files agree on a version', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { lodash: '^4.17.21' } });
    writePackageJson(join(dir, 'sub'), {
      dependencies: { lodash: '^4.17.21' },
    });

    const lodash = checkDependencies(dir).find((r) => r.name === 'lodash');
    expect(lodash?.versions).toEqual(['^4.17.21']);
  });

  it('reports a conflict when files disagree', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { lodash: '^4.17.21' } });
    writePackageJson(join(dir, 'sub'), { dependencies: { lodash: '^3.10.1' } });

    const lodash = checkDependencies(dir).find((r) => r.name === 'lodash');
    expect(lodash?.versions).toHaveLength(2);
    expect(lodash?.versions).toContain('^4.17.21');
    expect(lodash?.versions).toContain('^3.10.1');
  });

  it('returns results sorted alphabetically by package name', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      dependencies: { zod: '^3.0.0', axios: '^1.0.0', react: '^18.0.0' },
    });

    const names = checkDependencies(dir).map((r) => r.name);
    expect(names).toEqual([...names].sort());
  });
});

describe('checkDependencies — version deduplication', () => {
  it('counts a package in dependencies + devDependencies only once per file', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, {
      dependencies: { ts: '^5.0.0' },
      devDependencies: { ts: '^5.0.0' },
    });

    const ts = checkDependencies(dir).find((r) => r.name === 'ts');
    expect(ts?.usages).toHaveLength(1);
  });

  it('treats versions as opaque strings — no semver resolution', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { foo: '^1.0.0' } });
    writePackageJson(join(dir, 'sub'), { dependencies: { foo: '1.0.0' } });

    const foo = checkDependencies(dir).find((r) => r.name === 'foo');
    expect(foo?.versions).toHaveLength(2);
  });
});

// ─── exclude patterns ─────────────────────────────────────────────────────────

describe('checkDependencies — exclude patterns', () => {
  it('excludes a directory by exact name', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'legacy'), {
      dependencies: { react: '^16.0.0' },
    });

    const react = checkDependencies(dir, ['legacy']).find(
      (r) => r.name === 'react',
    );
    expect(react?.versions).toHaveLength(1);
  });

  it('excludes a directory by relative path', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { lodash: '^4.0.0' } });
    writePackageJson(join(dir, 'packages', 'internal'), {
      dependencies: { lodash: '^3.0.0' },
    });

    const lodash = checkDependencies(dir, ['packages/internal']).find(
      (r) => r.name === 'lodash',
    );
    expect(lodash?.versions).toHaveLength(1);
  });

  it('excludes directories matching a glob wildcard', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { zod: '^3.0.0' } });
    writePackageJson(join(dir, 'packages', 'app-legacy'), {
      dependencies: { zod: '^2.0.0' },
    });
    writePackageJson(join(dir, 'packages', 'lib-legacy'), {
      dependencies: { zod: '^1.0.0' },
    });

    const zod = checkDependencies(dir, ['*-legacy']).find(
      (r) => r.name === 'zod',
    );
    expect(zod?.versions).toHaveLength(1);
  });
});

// ─── .sddcignore ──────────────────────────────────────────────────────────────

describe('readSddcIgnore', () => {
  it('returns empty array when no .sddcignore exists', () => {
    expect(readSddcIgnore(makeTmpDir())).toEqual([]);
  });

  it('parses patterns, ignoring comments and blank lines', () => {
    const dir = makeTmpDir();
    writeFileSync(
      join(dir, '.sddcignore'),
      '# comment\n\ndist\nbuild\n  \n*.gen\n',
    );
    expect(readSddcIgnore(dir)).toEqual(['dist', 'build', '*.gen']);
  });
});

describe('checkDependencies — .sddcignore integration', () => {
  it('respects .sddcignore in the root directory', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, '.sddcignore'), 'legacy\n');
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'legacy'), {
      dependencies: { react: '^16.0.0' },
    });

    const react = checkDependencies(dir).find((r) => r.name === 'react');
    expect(react?.versions).toHaveLength(1);
  });

  it('respects .sddcignore in a subdirectory — affects only that subtree', () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, 'packages'), { recursive: true });
    writeFileSync(join(dir, 'packages', '.sddcignore'), 'internal\n');
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'packages', 'app'), {
      dependencies: { react: '^18.0.0' },
    });
    writePackageJson(join(dir, 'packages', 'internal'), {
      dependencies: { react: '^16.0.0' },
    });

    const react = checkDependencies(dir).find((r) => r.name === 'react');
    expect(react?.versions).toHaveLength(1);
  });

  it('a subdirectory .sddcignore does not affect sibling directories', () => {
    const dir = makeTmpDir();
    mkdirSync(join(dir, 'packages'), { recursive: true });
    writeFileSync(join(dir, 'packages', '.sddcignore'), 'internal\n');
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    // "internal" at the same level as "packages" — NOT a child of packages/
    writePackageJson(join(dir, 'internal'), {
      dependencies: { react: '^16.0.0' },
    });

    const react = checkDependencies(dir).find((r) => r.name === 'react');
    expect(react?.versions).toHaveLength(2);
  });

  it('accumulates patterns from root and nested .sddcignore files', () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, '.sddcignore'), 'legacy\n');
    mkdirSync(join(dir, 'packages'), { recursive: true });
    writeFileSync(join(dir, 'packages', '.sddcignore'), 'internal\n');
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'legacy'), {
      dependencies: { react: '^17.0.0' },
    });
    writePackageJson(join(dir, 'packages', 'internal'), {
      dependencies: { react: '^16.0.0' },
    });
    writePackageJson(join(dir, 'packages', 'app'), {
      dependencies: { react: '^18.0.0' },
    });

    const react = checkDependencies(dir).find((r) => r.name === 'react');
    expect(react?.versions).toHaveLength(1);
  });
});

// ─── updateDependencyVersion ───────────────────────────────────────────────────

describe('updateDependencyVersion', () => {
  it('updates a version in dependencies', () => {
    const dir = makeTmpDir();
    const file = join(dir, 'package.json');
    writeFileSync(
      file,
      JSON.stringify({ dependencies: { react: '^17.0.0' } }, null, 2),
    );

    updateDependencyVersion(file, 'react', '^18.0.0');

    const updated = JSON.parse(readFileSync(file, 'utf-8')) as {
      dependencies: Record<string, string>;
    };
    expect(updated.dependencies['react']).toBe('^18.0.0');
  });

  it('updates the same package across all dependency fields', () => {
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

  it('preserves all other fields in the file', () => {
    const dir = makeTmpDir();
    const file = join(dir, 'package.json');
    writeFileSync(
      file,
      JSON.stringify(
        {
          name: 'my-pkg',
          version: '1.0.0',
          dependencies: { react: '^17.0.0' },
        },
        null,
        2,
      ),
    );

    updateDependencyVersion(file, 'react', '^18.0.0');

    const updated = JSON.parse(readFileSync(file, 'utf-8')) as {
      name: string;
      version: string;
    };
    expect(updated.name).toBe('my-pkg');
    expect(updated.version).toBe('1.0.0');
  });

  it('is a no-op when the package is not present', () => {
    const dir = makeTmpDir();
    const file = join(dir, 'package.json');
    const original = JSON.stringify(
      { dependencies: { lodash: '^4.0.0' } },
      null,
      2,
    );
    writeFileSync(file, original);

    updateDependencyVersion(file, 'react', '^18.0.0');

    expect(readFileSync(file, 'utf-8')).toBe(original);
  });
});
