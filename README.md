# SuperDuperDependencyChecker

`sddc` scans a directory tree for `package.json` files and reports every npm
package that is declared with more than one version across the workspace.

```
✓ eslint                    ^8.57.0
✓ prettier                  ^3.2.0
✗ typescript
    packages/app/package.json    ^5.0.0
    packages/lib/package.json    ^5.4.0

9 packages checked, 1 with conflicts
```

Exit code is **0** when all versions are consistent and **1** when at least one
conflict is found — making it suitable for CI pipelines.

---

## Installation

```bash
npm install -g super-duper-dependency-checker
```

Or run without installing via `npx`:

```bash
npx super-duper-dependency-checker [directory]
```

---

## Usage

```
sddc [options] [directory]
```

`directory` defaults to the current working directory.

### Options

| Flag                    | Description                                           |
| ----------------------- | ----------------------------------------------------- |
| `-h`, `--help`          | Print this help message and exit                      |
| `-v`, `--version`       | Print the version number and exit                     |
| `-e`, `--exclude <pat>` | Exclude directories matching `<pat>` (repeatable)     |
| `-o`, `--errors-only`   | Only display packages with version conflicts          |
| `-i`, `--interactive`   | Interactively resolve conflicts by choosing a version |
| `--no-color`            | Disable coloured output                               |

### Examples

```bash
# Scan the current directory
sddc

# Scan a specific monorepo root
sddc /path/to/monorepo

# Ignore generated and build output directories
sddc -e dist -e .turbo -e '*.generated'

# Show only conflicts — useful in CI
sddc --errors-only

# Interactively unify conflicting versions
sddc --interactive
```

---

## Excluding directories

Directories can be excluded in two ways:

### Via the `-e` flag

Pass `-e <pattern>` once per pattern. Patterns can be repeated:

```bash
sddc -e dist -e build -e '*.test'
```

### Via `.sddcignore`

Place a `.sddcignore` file in any directory. Its patterns apply to all
subdirectories of that directory — analogous to `.gitignore`. Multiple
`.sddcignore` files at different levels accumulate: patterns from an ancestor
directory remain active in all descendants.

```
# .sddcignore
dist
build
*.generated
packages/internal
```

Lines beginning with `#` and blank lines are ignored.

### Pattern syntax

A pattern matches against:

- the **directory name** (e.g. `dist` matches any directory named `dist`)
- the **relative path** from the scan root (e.g. `packages/internal`)

The wildcard `*` matches any sequence of characters within a **single** path
segment. It does not cross directory boundaries.

| Pattern        | Matches                                       |
| -------------- | --------------------------------------------- |
| `dist`         | Any directory named `dist` at any depth       |
| `packages/old` | Only `packages/old` relative to the scan root |
| `*.generated`  | Any directory whose name ends in `.generated` |
| `test-*`       | Any directory whose name starts with `test-`  |

---

## Interactive mode

Running `sddc --interactive` (or `sddc -i`) launches a step-by-step prompt for
every conflicting package:

```
[1/2] typescript
  1) ^5.0.0
       packages/app/package.json
  2) ^5.4.0
       packages/lib/package.json

  → [1-2, custom string, or Enter to skip]:
```

- Type **1** or **2** to pick a listed version.
- Type any other string to use it as a custom version.
- Press **Enter** (empty) to skip this package.

After all choices are collected, `sddc` updates every affected `package.json`.
Only files that currently carry a _different_ version are rewritten.

> **Note:** Interactive mode requires a TTY (`stdin` must be a terminal).

---

## Version comparison

Versions are compared as **plain strings** — no semver resolution is performed.
`"^1.0.0"` and `"1.0.0"` are therefore treated as distinct versions and will
be reported as a conflict. This is intentional: the goal is to detect
inconsistencies in how versions are _written_, not just what they resolve to.

---

## Development

```bash
npm install          # install dependencies
npm run dev          # run from source via tsx
npm run build        # compile TypeScript → dist/
npm test             # run the test suite
npm run typecheck    # type-check without emitting
npm run lint         # ESLint
npm run format       # Prettier
```

### Project structure

```
src/
  index.ts        Entry point — routes to run() or runInteractive()
  checker.ts      Core domain: scan package.json files, detect conflicts,
                  update dependency versions
  options.ts      CLI option definitions, parseCliArgs(), HELP_TEXT
  colors.ts       Shared ANSI colour utilities
  format.ts       Render a DependencyReport[] as a human-readable string
  run.ts          Pure synchronous run() function (non-interactive path)
  interactive.ts  Async runInteractive() function (interactive path)

test/
  checker.test.ts Tests for checker.ts (scanning, patterns, .sddcignore, update)
  run.test.ts     Tests for run.ts and options.ts (CLI flags, integration)
```

---

## License

MIT
