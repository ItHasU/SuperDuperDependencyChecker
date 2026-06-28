/** ANSI escape codes used throughout the CLI output. */
export const C = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  reset: '\x1b[0m',
} as const;

/**
 * Wraps `text` with one or more ANSI codes and appends a reset sequence.
 * When multiple codes are supplied they are concatenated in order.
 */
export function colorize(text: string, ...codes: string[]): string {
  return codes.join('') + text + C.reset;
}
