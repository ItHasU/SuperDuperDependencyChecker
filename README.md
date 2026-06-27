# SuperDuperDependencyChecker

A terminal application (TypeScript) to check project dependencies.

> This is a minimal skeleton — the dependency-checking logic is not implemented
> yet. The CLI plumbing, build, lint, format, and test setup are ready to build
> on.

## Requirements

- Node.js >= 18

## Getting started

```bash
npm install
```

## Usage

Run in development (no build step, via `tsx`):

```bash
npm run dev -- --help
```

After building:

```bash
npm run build
node dist/index.js --help
# or, if linked globally:
sddc --help
```

### Options

| Flag              | Description                  |
| ----------------- | ---------------------------- |
| `-h`, `--help`    | Show the help message        |
| `-v`, `--version` | Print the version and exit   |

## Scripts

| Script                 | What it does                          |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Run the CLI from source with `tsx`    |
| `npm run build`        | Compile TypeScript to `dist/`         |
| `npm start`            | Run the compiled CLI                  |
| `npm test`             | Run the test suite once (`vitest`)    |
| `npm run test:watch`   | Run tests in watch mode               |
| `npm run lint`         | Lint with ESLint                      |
| `npm run lint:fix`     | Lint and auto-fix                     |
| `npm run format`       | Format with Prettier                  |
| `npm run typecheck`    | Type-check without emitting           |

## Project structure

```
src/
  index.ts   Executable entry point (reads argv, writes output, sets exit code)
  cli.ts     Pure run() logic — argument parsing and command dispatch
test/
  cli.test.ts
```

## License

MIT
