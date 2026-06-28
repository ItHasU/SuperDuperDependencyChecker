import { checkDependencies } from './checker.js';
import { formatReport } from './format.js';
import { HELP_TEXT, VERSION, PROGRAM_NAME, parseCliArgs } from './options.js';

/** Value returned by {@link run} — mirrors what `index.ts` writes to the process streams. */
export interface RunResult {
  /** Process exit code. 0 = success / no conflicts; 1 = conflicts or error. */
  code: number;
  /** Text to write to stdout. */
  stdout?: string;
  /** Text to write to stderr. */
  stderr?: string;
}

/**
 * Pure, synchronous entry point for non-interactive execution.
 *
 * Takes raw argv (without the leading `node` and script path), runs the
 * dependency scan, and returns what should be written to stdout/stderr plus
 * an exit code.  Keeping side-effects out of this function makes it easy to
 * unit-test without spawning a child process.
 *
 * @param argv  Argument vector to parse (typically `process.argv.slice(2)`).
 * @param cwd   Default scan directory when no positional argument is given.
 *              Defaults to `process.cwd()`.  Injectable for testing.
 */
export function run(argv: string[], cwd = process.cwd()): RunResult {
  const opts = parseCliArgs(argv, cwd);

  if (opts.parseError) {
    return { code: 1, stderr: `${opts.parseError}\n\n${HELP_TEXT}` };
  }
  if (opts.help) {
    return { code: 0, stdout: HELP_TEXT };
  }
  if (opts.version) {
    return { code: 0, stdout: `${PROGRAM_NAME} ${VERSION}\n` };
  }

  let reports;
  try {
    reports = checkDependencies(opts.targetDir, opts.exclude);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: 1,
      stderr: `Error scanning "${opts.targetDir}": ${message}\n`,
    };
  }

  const hasConflicts = reports.some((r) => r.versions.length > 1);
  return {
    code: hasConflicts ? 1 : 0,
    stdout: formatReport(
      reports,
      opts.targetDir,
      !opts.noColor,
      opts.errorsOnly,
    ),
  };
}
