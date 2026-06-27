import { describe, expect, it } from 'vitest';
import { PROGRAM_NAME, VERSION, run } from '../src/cli.js';

describe('run', () => {
  it('prints help with --help and exits 0', () => {
    const result = run(['--help']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
    expect(result.stderr).toBeUndefined();
  });

  it('prints help with the -h short flag', () => {
    const result = run(['-h']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Usage:');
  });

  it('prints the version with --version', () => {
    const result = run(['--version']);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(`${PROGRAM_NAME} ${VERSION}\n`);
  });

  it('greets when run with no arguments', () => {
    const result = run([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Hello from ${PROGRAM_NAME}!`);
  });

  it('errors on an unknown option', () => {
    const result = run(['--nope']);
    expect(result.code).toBe(1);
    expect(result.stderr).toBeDefined();
  });
});
