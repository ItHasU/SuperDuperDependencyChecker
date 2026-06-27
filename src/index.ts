#!/usr/bin/env node
import { run } from './cli.js';

const argv = process.argv.slice(2);

if (argv.some((a) => a === '-i' || a === '--interactive')) {
  import('./interactive.js')
    .then(({ runInteractive }) => runInteractive(argv))
    .then((code) => process.exit(code))
    .catch((err: unknown) => {
      process.stderr.write(String(err) + '\n');
      process.exit(1);
    });
} else {
  const result = run(argv);
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  process.exit(result.code);
}
