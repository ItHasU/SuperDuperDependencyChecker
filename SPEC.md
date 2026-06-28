# SuperDuperDependencyChecker — Technical Specification

## 1. Overview

`sddc` is a Node.js CLI tool that scans a directory tree for `package.json`
files and reports npm packages that are declared with inconsistent versions
across the workspace.  It is designed for monorepos where a package might
appear as a dependency in multiple sub-packages.

---

## 2. Architecture

The source tree follows a single-responsibility decomposition:

```
src/
  index.ts        Entry point
  checker.ts      Domain logic  (pure, file I/O only)
  options.ts      CLI parsing   (pure, no I/O)
  colors.ts       Display utils (pure, no I/O)
  format.ts       Formatting    (pure, no I/O)
  run.ts          Non-interactive orchestration
  interactive.ts  Interactive orchestration
```

### Dependency graph

```
index.ts
 ├── run.ts
 │    ├── checker.ts
 │    ├── format.ts ──── colors.ts
 │    └── options.ts
 └── interactive.ts
      ├── checker.ts
      ├── colors.ts
      └── options.ts
```

`checker.ts`, `options.ts`, `colors.ts`, and `format.ts` have **no side
effects** beyond filesystem reads/writes inside `checker.ts`.  They contain no
calls to `process.exit`, `process.stdout.write`, or `console.*`.

`run.ts` and `interactive.ts` are the only modules that communicate with the
outside world (via the `RunResult` return value and direct writes to
`process.stdout`/`process.stderr` respectively).

`index.ts` is the only module that calls `process.exit`.

---

## 3. Module specifications

### 3.1 `checker.ts`

#### Exported types

```typescript
interface DependencyUsage {
  version: string;          // exact string from package.json
  packageJsonPath: string;  // absolute path
}

interface DependencyReport {
  name: string;             // npm package name
  versions: string[];       // distinct version strings (length > 1 = conflict)
  usages: DependencyUsage[];
}
```

#### `readSddcIgnore(rootDir: string): string[]`

Reads `<rootDir>/.sddcignore`.  Returns an array of non-empty, non-comment
lines.  Returns `[]` if the file does not exist or cannot be read.

#### `checkDependencies(rootDir, excludePatterns?): DependencyReport[]`

**Algorithm:**

1. Call `findPackageJsonFiles(rootDir, excludePatterns, rootDir)`.
2. For each discovered `package.json`:
   a. Parse JSON; skip on parse failure.
   b. Iterate `dependencies`, `devDependencies`, `peerDependencies`,
      `optionalDependencies` in that order.
   c. For each `(name, version)` pair: if the package name has already been
      recorded for this file (from an earlier field), skip it — preventing
      spurious self-conflicts when the same package appears in multiple fields.
   d. Record `(filePath, version)` in an internal `Map<name, Map<version, path[]>>`.
3. Convert the map to a `DependencyReport[]`, sorted alphabetically by name.

**`findPackageJsonFiles` (internal):**

Recursive directory walk.  On entry into each directory:

1. Call `readSddcIgnore(dir)` and merge result with the inherited
   `activePatterns` → `patternsForChildren`.
2. Skip entries named `node_modules` or `.git` unconditionally.
3. For subdirectories: call `shouldExcludeDir`; recurse only if not excluded,
   passing `patternsForChildren`.
4. For files named `package.json`: add their absolute path to `results`.

**`shouldExcludeDir` (internal):**

A directory matches a pattern when either:
- its **base name** matches, or
- its **path relative to `rootDir`** (normalised to forward slashes) matches.

Pattern matching uses simple glob rules: `*` expands to `[^/]*`; all other
regex metacharacters are literal.

#### `updateDependencyVersion(filePath, packageName, newVersion): void`

1. Read and parse the file.
2. Detect indentation from the first indented string key (falls back to 2).
3. Update `packageName` in every dep field where it is present.
4. If any field was modified, write back `JSON.stringify(raw, null, indent)`
   preserving the original trailing newline.

---

### 3.2 `options.ts`

#### Exported constants

| Export         | Type     | Value                                    |
| -------------- | -------- | ---------------------------------------- |
| `VERSION`      | `string` | Current package version (`"0.1.0"`)      |
| `PROGRAM_NAME` | `string` | `"sddc"`                                 |
| `HELP_TEXT`    | `string` | Full help string printed by `--help`     |

#### `CliOptions` interface

| Field         | Type       | Source                        |
| ------------- | ---------- | ----------------------------- |
| `help`        | `boolean`  | `--help` / `-h`               |
| `version`     | `boolean`  | `--version` / `-v`            |
| `noColor`     | `boolean`  | `--no-color`                  |
| `errorsOnly`  | `boolean`  | `--errors-only` / `-o`        |
| `interactive` | `boolean`  | `--interactive` / `-i`        |
| `exclude`     | `string[]` | `--exclude` / `-e` (multiple) |
| `targetDir`   | `string`   | First positional, or `cwd`    |
| `parseError?` | `string`   | Set on unknown/invalid flags  |

#### `parseCliArgs(argv, cwd): CliOptions`

Wraps Node's built-in `parseArgs` from `node:util`.  Never throws — parse
failures are returned as `parseError`.

---

### 3.3 `colors.ts`

Exports the `C` object (ANSI escape sequences) and `colorize(text, ...codes)`.

`colorize` concatenates the requested codes, the text, and `C.reset`.  It is
the sole place in the codebase that constructs ANSI escape sequences.

---

### 3.4 `format.ts`

#### `formatReport(reports, rootDir, useColors, errorsOnly?): string`

Renders the report as a multi-line string.  Layout:

- **Consistent package** (one version): `✓ <name padded>  <version dimmed>`
- **Conflicting package** (multiple versions):
  ```
  ✗ <name>
      <rel-path padded>  <version>
      ...
  ```
- A blank line then a summary: `N packages checked, [all consistent | M with conflicts]`.

When `errorsOnly` is true, only conflicting packages are listed but the summary
always reflects the **full** report count.

Column widths are computed per-report to align values dynamically.

---

### 3.5 `run.ts`

#### `RunResult` interface

```typescript
interface RunResult {
  code: number;      // 0 = success, 1 = conflicts or error
  stdout?: string;
  stderr?: string;
}
```

#### `run(argv, cwd?): RunResult`

Synchronous.  Flow:

1. `parseCliArgs(argv, cwd)` → return error result if `parseError` is set.
2. Handle `--help` and `--version` early returns.
3. `checkDependencies(targetDir, exclude)` → return error result on exception.
4. `formatReport(reports, targetDir, !noColor, errorsOnly)`.
5. Return `{ code: hasConflicts ? 1 : 0, stdout }`.

---

### 3.6 `interactive.ts`

#### `runInteractive(argv, cwd?): Promise<number>`

Async.  Flow:

1. Guard: abort with exit code 1 if `!process.stdin.isTTY`.
2. `parseCliArgs` → abort on `parseError`.
3. `checkDependencies` → abort on exception.
4. If no conflicts: print success message, return 0.
5. For each conflict, display grouped versions and await `readline` input.
6. Build a `choices: Map<name, version | null>` (null = skipped).
7. For each non-null choice: `updateDependencyVersion` on every usage whose
   current version differs from the chosen one.
8. Print a summary of applied changes.
9. Return 0.

Ctrl+C is handled by a `SIGINT` listener on the `readline` interface that
prints "Aborted." and calls `process.exit(1)`.

---

### 3.7 `index.ts`

Entry point.  Checks argv for `-i` / `--interactive` before delegating:

- **Interactive path**: dynamic `import('./interactive.js')` → `runInteractive(argv)` → `process.exit(code)`.
- **Non-interactive path**: `run(argv)` → write stdout/stderr → `process.exit(code)`.

The dynamic import keeps the `readline` dependency out of the startup path for
non-interactive invocations.

---

## 4. `.sddcignore` file format

```
# This is a comment
dist
build
*.generated
packages/internal
```

- UTF-8 text file, one pattern per line.
- Lines where the trimmed content is empty or starts with `#` are ignored.
- Patterns follow the rules described in §3.1 (`shouldExcludeDir`).
- A `.sddcignore` applies to all subdirectories of the directory that contains it.
- Multiple `.sddcignore` files accumulate: patterns from parent directories
  remain active in all descendant directories.

---

## 5. Exit codes

| Code | Meaning                                          |
| ---- | ------------------------------------------------ |
| `0`  | All versions consistent; or `--help`/`--version` |
| `1`  | At least one conflict; or a scan error occurred  |

---

## 6. Constraints and design decisions

**String-only version comparison.** Semver resolution was deliberately excluded
to keep the tool simple and dependency-free.  The goal is to detect
inconsistencies in how versions are *written*, not what they resolve to.

**No runtime dependencies.** The tool relies entirely on Node.js built-in
modules (`node:fs`, `node:path`, `node:util`, `node:readline`).

**Pure functions where possible.** `options.ts`, `colors.ts`, `format.ts`, and
the algorithmic core of `checker.ts` are free of side effects and therefore
trivially unit-testable.

**Deduplication within a file.** When the same package appears in both
`dependencies` and `devDependencies` of the same `package.json`, only the
first occurrence (from `dependencies`) is counted.  This prevents a single file
from generating a false conflict with itself.

**`node_modules` and `.git` are hardcoded excludes.** They are skipped before
pattern evaluation and cannot be re-included via `-e`.
