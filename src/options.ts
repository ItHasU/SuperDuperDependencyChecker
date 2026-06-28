import { parseArgs } from 'node:util';

export const VERSION = '0.1.0';
export const PROGRAM_NAME = 'sddc';

/** Parsed and normalised representation of every CLI flag and argument. */
export interface CliOptions {
  help: boolean;
  version: boolean;
  /** When true, suppress ANSI colour codes in the output. */
  noColor: boolean;
  /** When true, only packages with version conflicts are printed. */
  errorsOnly: boolean;
  /** When true, launch the interactive conflict-resolution flow. */
  interactive: boolean;
  /** Directory-name or path patterns to exclude from the scan. */
  exclude: string[];
  /** Absolute or relative path to the directory to scan. Defaults to cwd. */
  targetDir: string;
  /** Set when `parseArgs` rejects the supplied argv. */
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
      --no-color         Disable coloured output

Patterns:
  Patterns match against directory names or their relative paths from the scan root.
  The wildcard * matches any sequence of characters within a single path segment.
  Patterns are also read line-by-line from .sddcignore files found during the scan
  (a .sddcignore in a given directory applies to all of its subdirectories).

Exit codes:
  0  All dependency versions are consistent (or --help / --version).
  1  At least one package has conflicting versions across package.json files,
     or an error occurred while scanning.
`;

/**
 * Parses raw process argv (without the leading `node` and script path) into a
 * strongly-typed {@link CliOptions} object.  Never throws — parse errors are
 * returned as the `parseError` field.
 */
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
