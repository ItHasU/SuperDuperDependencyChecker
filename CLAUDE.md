# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev              # run from source (no build needed, uses tsx)
npm run build            # compile TypeScript → dist/ and chmod +x dist/index.js
npm test                 # run full test suite (vitest)
npm run typecheck        # type-check without emitting
npm run lint             # ESLint
npm run format           # Prettier (write)
npm run format:check     # Prettier (check only)
```

Run a single test file:

```bash
npx vitest run test/checker.test.ts
```

Run tests matching a name pattern:

```bash
npx vitest run -t "exclude"
```

## Architecture

The CLI is split into single-responsibility modules. The key rule: only `index.ts` calls `process.exit`; only `run.ts` and `interactive.ts` write to `process.stdout`/`process.stderr`.

```
index.ts          Entry point — detects -i/--interactive, routes to run() or runInteractive()
options.ts        parseCliArgs(), CliOptions interface, HELP_TEXT, VERSION, PROGRAM_NAME
checker.ts        Domain logic: scan package.json files, detect conflicts, update versions
colors.ts         ANSI constants (C) and colorize() — shared by format.ts and interactive.ts
format.ts         Pure formatReport() — renders DependencyReport[] as a string
run.ts            Synchronous run() → RunResult (non-interactive path)
interactive.ts    Async runInteractive() using readline (interactive path)
```

Dependency graph:

```
index.ts → run.ts → { checker, format → colors, options }
         → interactive.ts → { checker, colors, options }
```

`interactive.ts` is loaded via dynamic `import()` in `index.ts` so `readline` stays out of the startup path for non-interactive calls.

## Key behaviours to preserve

- **String-only version comparison**: `^1.0.0` and `1.0.0` are distinct. No semver resolution.
- **Per-file deduplication**: if a package appears in both `dependencies` and `devDependencies` of the same file, only the first occurrence (field order: deps → devDeps → peerDeps → optionalDeps) is counted.
- **`.sddcignore` inheritance**: each directory's `.sddcignore` is read as `findPackageJsonFiles` recurses. Patterns accumulate downward but never affect sibling directories.
- **Exit codes**: 0 = all consistent; 1 = any conflict or scan error.

## TypeScript configuration

- `"module": "NodeNext"` — all imports within `src/` must use `.js` extensions (e.g. `import { run } from './run.js'`).
- Strict flags enabled: `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`.
- `"types": ["node"]` is set explicitly in `tsconfig.json` — required for the IDE language server to resolve Node globals.
- Test files (`test/`) are excluded from `tsc` compilation; Vitest handles them via tsx transform.
