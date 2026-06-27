import { parseArgs } from 'node:util';

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
  ${PROGRAM_NAME} [options]

Options:
  -h, --help       Show this help message and exit
  -v, --version    Print the version number and exit
`;

/**
 * Pure entry point: takes argv (without the leading `node` and script path)
 * and returns what should be printed plus an exit code. Kept side-effect free
 * so it is easy to unit test.
 */
export function run(argv: string[]): RunResult {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: 'boolean', short: 'h', default: false },
        version: { type: 'boolean', short: 'v', default: false },
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

  const { values } = parsed;

  if (values.help) {
    return { code: 0, stdout: HELP_TEXT };
  }

  if (values.version) {
    return { code: 0, stdout: `${PROGRAM_NAME} ${VERSION}\n` };
  }

  // Minimal skeleton: no command yet. Show help to point the way.
  return {
    code: 0,
    stdout: `Hello from ${PROGRAM_NAME}!\n\n${HELP_TEXT}`,
  };
}
