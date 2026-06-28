import { relative } from 'node:path';
import { type DependencyReport } from './checker.js';
import { C, colorize } from './colors.js';

/**
 * Renders a dependency report as a human-readable string.
 *
 * @param reports    Full list returned by {@link checkDependencies}.
 * @param rootDir    Scan root — used to compute relative paths in the output.
 * @param useColors  When true, ANSI colour codes are injected into the output.
 * @param errorsOnly When true, only conflicting packages are listed.
 *                   The summary line always reflects the full report count.
 */
export function formatReport(
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
          ...report.usages.map(
            (u) => relative(rootDir, u.packageJsonPath).length,
          ),
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
