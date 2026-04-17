'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const INCLUDED_EXTENSIONS = new Set(['.js', '.cjs', '.mjs']);
const EXCLUDED_DIRS = new Set([
  '.git',
  '.cursor',
  'data',
  'node_modules',
  'public/generated',
]);
const EXCLUDED_FILES = new Set([
  'deploy.js',
  'upload.js',
  'auto-sync.js',
]);

function isExcludedDir(relativeDir) {
  return EXCLUDED_DIRS.has(relativeDir.replace(/\\/g, '/'));
}

function collectFiles(dir, relativeDir, results) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  entries.forEach((entry) => {
    const absolutePath = path.join(dir, entry.name);
    const relativePath = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
    const normalizedRelativePath = relativePath.replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (isExcludedDir(normalizedRelativePath)) return;
      collectFiles(absolutePath, relativePath, results);
      return;
    }

    if (EXCLUDED_FILES.has(entry.name)) return;
    if (!INCLUDED_EXTENSIONS.has(path.extname(entry.name))) return;
    results.push(absolutePath);
  });
}

const files = [];
collectFiles(ROOT, '', files);

let failed = false;

files.sort().forEach((filePath) => {
  try {
    execFileSync(process.execPath, ['--check', filePath], {
      stdio: 'pipe',
    });
    process.stdout.write(`[ok] ${path.relative(ROOT, filePath)}\n`);
  } catch (error) {
    failed = true;
    process.stderr.write(`[error] ${path.relative(ROOT, filePath)}\n`);
    if (error.stdout) process.stderr.write(error.stdout.toString());
    if (error.stderr) process.stderr.write(error.stderr.toString());
  }
});

if (failed) {
  process.exit(1);
}

process.stdout.write(`Checked ${files.length} JavaScript files.\n`);
