# Publishing

Publication is done manually from the terminal. GitHub Actions only verifies the build on tag push — it never publishes to npm.

## Prerequisites

- npm account with publish rights to `super-duper-dependency-checker`
- Logged in: `npm whoami` (if not: `npm login`)

## Steps

### 1. Prepare

```bash
git checkout main && git pull
npm ci
npm test && npm run typecheck && npm run lint
```

### 2. Bump the version

```bash
npm version patch   # patch: 0.1.0 → 0.1.1
npm version minor   # minor: 0.1.0 → 0.2.0
npm version major   # major: 0.1.0 → 1.0.0
```

This updates `package.json`, creates a commit, and creates a `vX.Y.Z` git tag.

### 3. Build and publish

```bash
npm run build
npm publish
```

### 4. Push to GitHub

```bash
git push && git push --tags
```

The `v*` tag triggers the `Release` workflow on GitHub which re-runs typecheck, tests, and build as a sanity check — but does **not** publish anything.

### 5. GitHub Release (optional)

Create a release manually on GitHub from the pushed tag if you want release notes.
