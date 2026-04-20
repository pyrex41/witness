// Singleton witness/shen environment shared across every .shen render in a
// single Astro build. Shen state is global per instance and $.exec is not
// concurrency-safe, so all calls serialize through a promise-chain mutex.

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const { boot } = require('../boot.js');

let shenPromise = null;
const fileEntries = new Map(); // filepath -> entry-name already loaded

let queue = Promise.resolve();
function withLock(fn) {
  const next = queue.then(fn, fn);
  queue = next.catch(() => {});
  return next;
}

async function getShen() {
  if (!shenPromise) {
    shenPromise = (async () => {
      const $ = await boot();
      await $.exec('(tc -)');
      return $;
    })();
  }
  return shenPromise;
}

function hashPath(p) {
  return crypto.createHash('sha256').update(p).digest('hex').slice(0, 12);
}

// Load a .shen file into the shared shen env, renaming its top-level
// `(define render ...)` to a unique name so subsequent files don't clobber
// each other's entry points. Helper definitions remain shared — collisions
// are the author's responsibility (prefix helpers if you need isolation).
async function loadFile($, filepath) {
  const id = hashPath(filepath);
  const entry = `__witness_render_${id}`;
  const src = readFileSync(filepath, 'utf8');
  const rewritten = src.replace(/\(define\s+render\b/, `(define ${entry}`);
  if (rewritten === src) {
    throw new Error(
      `witness: ${filepath} must contain a top-level (define render Props -> ...) form`,
    );
  }
  const tmpfile = path.join(os.tmpdir(), `witness-${id}.shen`);
  writeFileSync(tmpfile, rewritten);
  try {
    await $.load(tmpfile);
  } finally {
    try { unlinkSync(tmpfile); } catch {}
  }
  fileEntries.set(filepath, entry);
  return entry;
}

export async function renderComponent(filepath, props) {
  const $ = await getShen();
  return withLock(async () => {
    let entry = fileEntries.get(filepath);
    if (!entry) entry = await loadFile($, filepath);
    const propsName = `__witness_props_${hashPath(filepath)}`;
    await $.define(propsName, () => props || {});
    return $.exec(`(render-fragment (${entry} (${propsName})))`);
  });
}

// Called by the vite plugin's HMR hook.
export function invalidate(filepath) {
  fileEntries.delete(filepath);
}
