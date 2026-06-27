import { parseArgs } from 'node:util';
import { relative } from 'node:path';
import { checkDependencies, type DependencyReport } from './checker.js';

export const VERSION = '0.1.0';
export const PROGRAM_NAME = 'sddc';

export interface RunResult {
  /** Process exit code. */
  code: number;
  /** Text to write to stdout. */
  stdout?: string;
  /** Text to write to stderr. */
  stderr?: string;
}

export interface CliOptions {
  help: boolean;
  version: boolean;
  noColor: boolean;
  errorsOnly: boolean;
  interactive: boolean;
  exclude: string[];
  targetDir: string;
  parseError?: string;
}

export const HELP_TEXT = `${PROGRAM_NAME} — SuperDuperDependencyChecker

Usage:
  ${PROGRAM_NAME} [options] [directory]

Arguments:
  directory              Directory to scan for package.json files (default: current directory)

Options:
  -h, --help             Show this help message and exit
  -v, --version          Print the version number and exit
  -e, --exclude <pat>    Exclude directories matching <pat> (can be repeated)
  -o, --errors-only      Only display packages with version conflicts
  -i, --interactive      Interactively choose a version to resolve conflicts
      --no-color         Disable colored output

Patterns:
  Patterns match against directory names or relative paths from the root.
  Use * as a wildcard within a single path segment (e.g. *.generated).
  Patterns are also read line-by-line from .sddcignore in the target directory.
`;

const C = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

export function colorize(text: string, ...codes: string[]): string {
  return codes.join('') + text + C.reset;
}

export function parseCliArgs(argv: string[], cwd: string): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
        'no-color': { type: 'boolean', default: false },
        'errors-only': { type: 'boolean', short: 'o', default: false },
        interactive: { type: 'boolean', short: 'i', default: false },
        exclude: { type: 'string', short: 'e', multiple: true },
      },
      allowPositionals: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      help: false,
      version: false,
      noColor: false,
      errorsOnly: false,
      interactive: false,
      exclude: [],
      targetDir: cwd,
      parseError: message,
    };
  }

  const { values, positionals } = parsed;
  return {
    help: values.help ?? false,
    version: values.version ?? false,
    noColor: values['no-color'] ?? false,
    errorsOnly: values['errors-only'] ?? false,
    interactive: values.interactive ?? false,
    exclude: (values.exclude as string[] | undefined) ?? [],
    targetDir: positionals[0] ?? cwd,
  };
}

function formatReport(
  reports: DependencyReport[],
  rootDir: string,
  useColors: boolean,
  errorsOnly = false,
): string {
  if (reports.length === 0) {
    return 'No dependencies found.\n';
  }

  const toDisplay = errorsOnly
    ? reports.filter((r) => r.versions.length > 1)
    : reports;

  const conflictCount = reports.filter((r) => r.versions.length > 1).length;
  const lines: string[] = [];

  if (toDisplay.length > 0) {
    const maxNameLen = Math.max(...toDisplay.map((r) => r.name.length));

    for (const report of toDisplay) {
      const hasConflict = report.versions.length > 1;
      const namePadded = report.name.padEnd(maxNameLen + 2);

      if (!hasConflict) {
        const version = report.usages[0]!.version;
        lines.push(
          useColors
            ? `${colorize('✓', C.green)} ${namePadded}${colorize(version, C.dim)}`
            : `✓ ${namePadded}${version}`,
        );
      } else {
        lines.push(
          useColors
            ? colorize(`✗ ${report.name}`, C.red, C.bold)
            : `✗ ${report.name}`,
        );

        const maxPathLen = Math.max(
          ...report.usages.map((u) => relative(rootDir, u.packageJsonPath).length),
        );

        for (const usage of report.usages) {
          const relPath = relative(rootDir, usage.packageJsonPath);
          const pathPadded = relPath.padEnd(maxPathLen + 2);
          lines.push(
            useColors
              ? `    ${colorize(pathPadded, C.dim)}${colorize(usage.version, C.red)}`
              : `    ${pathPadded}${usage.version}`,
          );
        }
      }
    }
    lines.push('');
  }

  const summary =
    conflictCount === 0
      ? `${reports.length} packages checked, all consistent`
      : `${reports.length} packages checked, ${conflictCount} with conflicts`;

  lines.push(
    useColors
      ? colorize(summary, conflictCount === 0 ? C.green : C.red)
      : summary,
  );

  return lines.join('\n') + '\n';
}

/**
 * Pure entry point for non-interactive execution.
 * @param cwd - Default scan directory; injectable for testing.
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

  let reports: DependencyReport[];
  try {
    reports = checkDependencies(opts.targetDir, opts.exclude);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, stderr: `Error scanning "${opts.targetDir}": ${message}\n` };
  }

  const hasConflicts = reports.some((r) => r.versions.length > 1);
  return {
    code: hasConflicts ? 1 : 0,
    stdout: formatReport(reports, opts.targetDir, !opts.noColor, opts.errorsOnly),
  };
}
