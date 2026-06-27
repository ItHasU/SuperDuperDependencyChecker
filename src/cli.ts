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

const HELP_TEXT = `${PROGRAM_NAME} — SuperDuperDependencyChecker

Usage:
  ${PROGRAM_NAME} [options] [directory]

Arguments:
  directory    Directory to scan for package.json files (default: current directory)

Options:
  -h, --help       Show this help message and exit
  -v, --version    Print the version number and exit
  --no-color       Disable colored output
`;

const C = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
};

function colorize(text: string, ...codes: string[]): string {
  return codes.join('') + text + C.reset;
}

function formatReport(
  reports: DependencyReport[],
  rootDir: string,
  useColors: boolean,
): string {
  if (reports.length === 0) {
    return 'No dependencies found.\n';
  }

  const maxNameLen = Math.max(...reports.map((r) => r.name.length));
  const lines: string[] = [];

  for (const report of reports) {
    const hasConflict = report.versions.length > 1;
    const namePadded = report.name.padEnd(maxNameLen + 2);

    if (!hasConflict) {
      const version = report.usages[0]!.version;
      if (useColors) {
        lines.push(
          `${colorize('✓', C.green)} ${namePadded}${colorize(version, C.dim)}`,
        );
      } else {
        lines.push(`✓ ${namePadded}${version}`);
      }
    } else {
      if (useColors) {
        lines.push(colorize(`✗ ${report.name}`, C.red, C.bold));
      } else {
        lines.push(`✗ ${report.name}`);
      }

      const maxPathLen = Math.max(
        ...report.usages.map((u) => relative(rootDir, u.packageJsonPath).length),
      );

      for (const usage of report.usages) {
        const relPath = relative(rootDir, usage.packageJsonPath);
        const pathPadded = relPath.padEnd(maxPathLen + 2);
        if (useColors) {
          lines.push(
            `    ${colorize(pathPadded, C.dim)}${colorize(usage.version, C.red)}`,
          );
        } else {
          lines.push(`    ${pathPadded}${usage.version}`);
        }
      }
    }
  }

  const conflictCount = reports.filter((r) => r.versions.length > 1).length;
  const summary =
    conflictCount === 0
      ? `${reports.length} packages checked, all consistent`
      : `${reports.length} packages checked, ${conflictCount} with conflicts`;

  lines.push('');
  lines.push(
    useColors
      ? colorize(summary, conflictCount === 0 ? C.green : C.red)
      : summary,
  );

  return lines.join('\n') + '\n';
}

/**
 * Pure entry point: takes argv (without the leading `node` and script path)
 * and returns what should be printed plus an exit code.
 *
 * @param cwd - Used as the default scan directory; injectable for testing.
 */
export function run(argv: string[], cwd = process.cwd()): RunResult {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
        'no-color': { type: 'boolean', default: false },
      },
      allowPositionals: true,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      code: 1,
      stderr: `${message}\n\n${HELP_TEXT}`,
    };
  }

  const { values, positionals } = parsed;

  if (values.help) {
    return { code: 0, stdout: HELP_TEXT };
  }

  if (values.version) {
    return { code: 0, stdout: `${PROGRAM_NAME} ${VERSION}\n` };
  }

  const targetDir = positionals[0] ?? cwd;
  const useColors = !values['no-color'];

  let reports: DependencyReport[];
  try {
    reports = checkDependencies(targetDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, stderr: `Error scanning "${targetDir}": ${message}\n` };
  }

  const hasConflicts = reports.some((r) => r.versions.length > 1);

  return {
    code: hasConflicts ? 1 : 0,
    stdout: formatReport(reports, targetDir, useColors),
  };
}
