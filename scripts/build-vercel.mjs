import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const output = path.join(root, 'dist');
assert(path.isAbsolute(output) && path.dirname(output) === root && path.basename(output) === 'dist');
await fs.rm(output, { recursive: true, force: true });
await fs.mkdir(output);
for (const file of ['index.html', 'styles.css', 'app.js']) {
  await fs.copyFile(path.join(root, file), path.join(output, file));
}
console.log('Built dist/ with only index.html, styles.css, and app.js.');
