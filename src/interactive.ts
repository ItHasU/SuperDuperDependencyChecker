import { createInterface } from 'node:readline';
import { relative } from 'node:path';
import {
  checkDependencies,
  updateDependencyVersion,
  type DependencyReport,
} from './checker.js';
import { C, colorize } from './colors.js';
import { parseCliArgs } from './options.js';

function makePrompt(
  rl: ReturnType<typeof createInterface>,
  question: string,
): Promise<string> {
  return new Promise((resolve) => rl.question(question, (a) => resolve(a.trim())));
}

/**
 * Interactive conflict-resolution flow.
 *
 * Scans the target directory, then for each package that has more than one
 * version in use it presents the conflicting versions and waits for the user
 * to pick one (by number), type a custom version string, or press Enter to
 * skip.  Chosen versions are written back to the relevant package.json files.
 *
 * @param argv  Raw process argv (without `node` and script path).
 * @param cwd   Default scan directory. Defaults to `process.cwd()`.
 * @returns     Exit code — 0 on success, 1 on error.
 */
export async function runInteractive(
  argv: string[],
  cwd = process.cwd(),
): Promise<number> {
  if (!process.stdin.isTTY) {
    process.stderr.write('Interactive mode requires a terminal (stdin is not a TTY).\n');
    return 1;
  }

  const opts = parseCliArgs(argv, cwd);

  if (opts.parseError) {
    process.stderr.write(`${opts.parseError}\n`);
    return 1;
  }

  let reports: DependencyReport[];
  try {
    reports = checkDependencies(opts.targetDir, opts.exclude);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Error scanning "${opts.targetDir}": ${message}\n`);
    return 1;
  }

  const conflicts = reports.filter((r) => r.versions.length > 1);
  const col = !opts.noColor;

  if (conflicts.length === 0) {
    process.stdout.write(
      col
        ? colorize(`All ${reports.length} packages are consistent. Nothing to do.\n`, C.green)
        : `All ${reports.length} packages are consistent. Nothing to do.\n`,
    );
    return 0;
  }

  const plural = conflicts.length > 1 ? 's' : '';
  process.stdout.write(
    `\nFound ${col ? colorize(String(conflicts.length), C.red, C.bold) : String(conflicts.length)} package${plural} with conflicting versions.\n\n`,
  );

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => {
    process.stdout.write('\nAborted.\n');
    rl.close();
    process.exit(1);
  });

  // choices: packageName → chosen version string, or null to skip
  const choices = new Map<string, string | null>();

  try {
    for (let i = 0; i < conflicts.length; i++) {
      const report = conflicts[i]!;
      const header = `[${i + 1}/${conflicts.length}] ${report.name}`;
      process.stdout.write(col ? colorize(header, C.bold) + '\n' : header + '\n');

      // Group usages by version to avoid repeating the version label
      const byVersion = new Map<string, string[]>();
      for (const usage of report.usages) {
        const paths = byVersion.get(usage.version) ?? [];
        paths.push(usage.packageJsonPath);
        byVersion.set(usage.version, paths);
      }

      const versionList = [...byVersion.entries()];
      for (const [idx, [version, paths]] of versionList.entries()) {
        const num = `  ${idx + 1}) `;
        process.stdout.write(
          col ? `${num}${colorize(version, C.cyan)}\n` : `${num}${version}\n`,
        );
        for (const p of paths) {
          const rel = relative(opts.targetDir, p);
          process.stdout.write(col ? `       ${colorize(rel, C.dim)}\n` : `       ${rel}\n`);
        }
      }

      const hint = `1-${versionList.length}, custom string, or Enter to skip`;
      const promptLine = col
        ? `\n  ${colorize('→', C.bold)} [${hint}]: `
        : `\n  → [${hint}]: `;

      const answer = await makePrompt(rl, promptLine);
      process.stdout.write('\n');

      if (!answer) {
        choices.set(report.name, null);
        continue;
      }

      const num = parseInt(answer, 10);
      if (!isNaN(num) && num >= 1 && num <= versionList.length) {
        choices.set(report.name, versionList[num - 1]![0]);
      } else {
        choices.set(report.name, answer);
      }
    }
  } finally {
    rl.close();
  }

  // Apply choices
  type Applied = { pkg: string; version: string; file: string };
  const applied: Applied[] = [];
  const skipped: string[] = [];

  for (const [pkg, version] of choices) {
    if (version === null) {
      skipped.push(pkg);
      continue;
    }
    const report = conflicts.find((r) => r.name === pkg)!;
    for (const usage of report.usages) {
      if (usage.version !== version) {
        updateDependencyVersion(usage.packageJsonPath, pkg, version);
        applied.push({ pkg, version, file: usage.packageJsonPath });
      }
    }
  }

  process.stdout.write('\n');

  if (applied.length === 0) {
    process.stdout.write('No changes applied.\n');
    return 0;
  }

  process.stdout.write(col ? colorize('Changes applied:\n', C.bold) : 'Changes applied:\n');
  for (const { pkg, version, file } of applied) {
    const rel = relative(opts.targetDir, file);
    process.stdout.write(
      col
        ? `  ${colorize('✓', C.green)} ${pkg} → ${colorize(version, C.cyan)} in ${colorize(rel, C.dim)}\n`
        : `  ✓ ${pkg} → ${version} in ${rel}\n`,
    );
  }
  if (skipped.length > 0) {
    process.stdout.write(
      col
        ? `  ${colorize('−', C.dim)} Skipped: ${skipped.join(', ')}\n`
        : `  − Skipped: ${skipped.join(', ')}\n`,
    );
  }

  return 0;
}
