/**
 * Integration tests for src/run.ts and src/options.ts.
 *
 * Tests the public run() entry point end-to-end: argument parsing, scanning,
 * formatting, exit codes, and all CLI flags.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, it, expect, afterEach } from 'vitest';
import { run } from '../src/run.js';
import { parseCliArgs } from '../src/options.js';
import { PROGRAM_NAME, VERSION } from '../src/options.js';

// ─── Fixture helpers ───────────────────────────────────────────────────────────

let tmpDirs: string[] = [];

function makeTmpDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'sddc-run-'));
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

// ─── parseCliArgs ─────────────────────────────────────────────────────────────

describe('parseCliArgs', () => {
  it('defaults: no flags, no positional', () => {
    const opts = parseCliArgs([], '/cwd');
    expect(opts.help).toBe(false);
    expect(opts.version).toBe(false);
    expect(opts.noColor).toBe(false);
    expect(opts.errorsOnly).toBe(false);
    expect(opts.interactive).toBe(false);
    expect(opts.exclude).toEqual([]);
    expect(opts.targetDir).toBe('/cwd');
    expect(opts.parseError).toBeUndefined();
  });

  it('parses a positional directory', () => {
    expect(parseCliArgs(['/some/path'], '/cwd').targetDir).toBe('/some/path');
  });

  it('sets parseError on unknown flag', () => {
    expect(parseCliArgs(['--nope'], '/cwd').parseError).toBeDefined();
  });

  it('parses --exclude / -e (multiple)', () => {
    const opts = parseCliArgs(['-e', 'dist', '--exclude', 'build'], '/cwd');
    expect(opts.exclude).toEqual(['dist', 'build']);
  });

  it('parses --errors-only / -o', () => {
    expect(parseCliArgs(['-o'], '/cwd').errorsOnly).toBe(true);
    expect(parseCliArgs(['--errors-only'], '/cwd').errorsOnly).toBe(true);
  });

  it('parses --interactive / -i', () => {
    expect(parseCliArgs(['-i'], '/cwd').interactive).toBe(true);
  });

  it('parses --no-color', () => {
    expect(parseCliArgs(['--no-color'], '/cwd').noColor).toBe(true);
  });
});

// ─── run — meta flags ─────────────────────────────────────────────────────────

describe('run — meta flags', () => {
  it('--help exits 0 and prints usage', () => {
    const result = run(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stderr).toBeUndefined();
  });

  it('-h is an alias for --help', () => {
    const result = run(['-h']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('--version exits 0 and prints the version', () => {
    const result = run(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${PROGRAM_NAME} ${VERSION}\n`);
  });

  it('-v is an alias for --version', () => {
    expect(run(['-v']).stdout).toContain(VERSION);
  });

  it('unknown flag exits 1 with a message on stderr', () => {
    const result = run(['--nope']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBeDefined();
  });
});

// ─── run — scanning ───────────────────────────────────────────────────────────

describe('run — scanning', () => {
  it('uses the cwd parameter when no directory is given', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });

    const result = run(['--no-color'], dir);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('react');
  });

  it('exits 0 and prints ✓ when all versions match', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'sub'), { dependencies: { react: '^18.0.0' } });

    const result = run([dir, '--no-color']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('✓');
    expect(result.stdout).toContain('all consistent');
  });

  it('exits 1 and prints ✗ when versions conflict', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'sub'), { dependencies: { react: '^17.0.0' } });

    const result = run([dir, '--no-color']);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('✗');
    expect(result.stdout).toContain('conflicts');
  });

  it('shows conflicting paths and versions in the output', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { ts: '^5.0.0' } });
    writePackageJson(join(dir, 'sub'), { dependencies: { ts: '^4.9.0' } });

    const result = run([dir, '--no-color']);
    expect(result.stdout).toContain('package.json');
    expect(result.stdout).toContain('^5.0.0');
    expect(result.stdout).toContain('^4.9.0');
  });
});

// ─── run — --exclude ──────────────────────────────────────────────────────────

describe('run — --exclude', () => {
  it('accepts multiple -e patterns and exits 0 when excluded dirs resolve conflicts', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0' } });
    writePackageJson(join(dir, 'old'), { dependencies: { react: '^17.0.0' } });
    writePackageJson(join(dir, 'legacy'), { dependencies: { react: '^16.0.0' } });

    const result = run([dir, '-e', 'old', '-e', 'legacy', '--no-color']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('all consistent');
  });
});

// ─── run — --errors-only ──────────────────────────────────────────────────────

describe('run — --errors-only', () => {
  it('hides consistent packages but keeps them in the summary count', () => {
    const dir = makeTmpDir();
    writePackageJson(dir, { dependencies: { react: '^18.0.0', ts: '^5.0.0' } });
    writePackageJson(join(dir, 'sub'), { dependencies: { react: '^17.0.0', ts: '^5.0.0' } });

    const result = run([dir, '--errors-only', '--no-color']);
    expect(result.code).toBe(1);
    expect(result.stdout).not.toContain('✓');
    expect(result.stdout).toContain('✗');
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
