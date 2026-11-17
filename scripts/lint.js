#!/usr/bin/env node
'use strict';

/**
 * Dependency-free lint: syntax-checks every JavaScript file, keeps the
 * published file list honest, and fails on stray debug statements.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const DIRS = ['src', 'test', 'examples', 'scripts', '.github'];
const SKIP = new Set(['node_modules', '.git', 'coverage']);

const problems = [];

function walk(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (SKIP.has(entry.name)) return [];
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return full.endsWith('.js') ? [full] : [];
  });
}

const files = DIRS.flatMap((dir) => walk(path.join(root, dir)));

for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (err) {
    problems.push(`${path.relative(root, file)}: ${String(err.stderr || err.message).split('\n')[0]}`);
  }

  const source = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  // Ignore anything inside comments before looking for debug leftovers.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  if (/\bconsole\.log\(/.test(code) && !rel.startsWith('examples') && !rel.startsWith('scripts')) {
    problems.push(`${rel}: console.log left in library or test code`);
  }
  if (/\t/.test(source)) {
    problems.push(`${rel}: tab character found, use spaces`);
  }
  if (/[ \t]+$/m.test(source)) {
    problems.push(`${rel}: trailing whitespace`);
  }
}

// The published tarball must contain the entry point, the types and the docs.
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const required = [pkg.main, pkg.types, 'README.md', 'LICENSE'];
for (const entry of required) {
  const name = String(entry).replace(/^\.\//, '');
  const inFiles = (pkg.files || []).some((entry) => {
    const dir = String(entry).replace(/^\.\//, '').replace(/\/$/, '');
    return dir === name || name.startsWith(`${dir}/`);
  });
  const covered = fs.existsSync(path.join(root, name)) && inFiles;
  if (!covered) problems.push(`package.json: "${entry}" would not be published`);
}

if (problems.length) {
  console.error(`lint failed with ${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(`lint ok: ${files.length} files checked`);
