#!/usr/bin/env node
// cli/measure.js — Extract text/font pairs from Shen files and measure with Pretext
//
// Scans for (assert-fits "text" "font" N) and (proven-text "text" "font" N) calls,
// measures each unique (text, font) pair, writes .witness/measurements.shen

const fs = require('fs');
const path = require('path');

// Polyfill OffscreenCanvas for Node.js
const { createCanvas } = require('canvas');
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(w, h) { this._canvas = createCanvas(w, h); }
    getContext(type) { return this._canvas.getContext(type); }
  };
}

const { prepareWithSegments, layoutWithLines } = require('@chenglou/pretext');

let systemFontFamilies = null;
function loadSystemFonts() {
  if (systemFontFamilies !== null) return;
  try {
    const { execSync } = require('child_process');
    const output = execSync('fc-list : family', { encoding: 'utf8', timeout: 5000 });
    systemFontFamilies = new Set(
      output.split('\n').map(l => l.trim().toLowerCase()).filter(Boolean)
        .flatMap(l => l.split(',').map(f => f.trim()))
    );
  } catch (_) {
    systemFontFamilies = false;
  }
}

function isFontAvailable(fontSpec) {
  const generics = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
  const family = fontSpec.replace(/^[\d.]+px\s*/, '').trim();
  if (generics.includes(family.toLowerCase())) return true;
  loadSystemFonts();
  if (systemFontFamilies) return systemFontFamilies.has(family.toLowerCase());
  return true; // Can't detect; skip warning
}

function measureText(text, font) {
  const prepared = prepareWithSegments(String(text), String(font));
  const result = layoutWithLines(prepared, 1e7, 20);
  return result.lines[0]?.width ?? 0;
}

// Extract string literals from Shen source — matches (assert-fits "..." "..." N)
// and (proven-text "..." "..." N). Also handles (mk-font "name" size) inline.
function extractPairs(source) {
  const pairs = new Map();

  // Match (assert-fits "text" "font" N) or (assert-fits "text" (mk-font "name" size) N)
  // Match (proven-text "text" "font" N) or (proven-text "text" (mk-font "name" size) N)
  const patterns = [
    /\(assert-fits\s+"([^"]+)"\s+"([^"]+)"\s+[\d.]+\)/g,
    /\(assert-fits\s+"([^"]+)"\s+\(mk-font\s+"([^"]+)"\s+(\d+)\)\s+[\d.]+\)/g,
    /\(proven-text\s+"([^"]+)"\s+"([^"]+)"\s+[\d.]+\)/g,
    /\(proven-text\s+"([^"]+)"\s+\(mk-font\s+"([^"]+)"\s+(\d+)\)\s+[\d.]+\)/g,
    /\(fits\?\s+"([^"]+)"\s+"([^"]+)"\s+[\d.]+\)/g,
    /\(fits\?\s+"([^"]+)"\s+\(mk-font\s+"([^"]+)"\s+(\d+)\)\s+[\d.]+\)/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source)) !== null) {
      const text = match[1];
      let font;
      if (match[3]) {
        // mk-font pattern: name + size → "Npx Name"
        font = `${match[3]}px ${match[2]}`;
      } else {
        font = match[2];
      }
      const key = `${text}\0${font}`;
      if (!pairs.has(key)) {
        pairs.set(key, { text, font });
      }
    }
  }

  return [...pairs.values()];
}

// --- Tier 2 (bounded-string) support ---------------------------------------
// Worst-case proofs measure each glyph of an alphabet, not whole strings, so
// the SBCL/shen-cl proof path needs per-character measurements in the cache.
// When a file uses any bounded form we measure every character of a standard
// universe (covers digits, hex-digits, lower, upper, letters, alnum,
// price-chars) plus any literal alphabet characters, for every font the file
// references. This keeps `widest-glyph` resolvable under `*measurements*`.

const STANDARD_CHARS =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ.,$+-%/: ";

function usesBoundedForms(source) {
  return /\b(?:assert-bounded-fits|bounded-text|bounded-fits\?)\b/.test(source);
}

// Fonts referenced anywhere in the file, resolved to Pretext's "Npx Name".
function extractFonts(source) {
  const fonts = new Set();
  let m;
  const mkFont = /\(mk-font\s+"([^"]+)"\s+(\d+(?:\.\d+)?)\)/g;
  while ((m = mkFont.exec(source)) !== null) fonts.add(`${m[2]}px ${m[1]}`);
  const literal = /"(\d+(?:\.\d+)?px\s+[^"]+)"/g;
  while ((m = literal.exec(source)) !== null) fonts.add(m[1]);
  return [...fonts];
}

// Literal alphabet characters: (alphabet-of "...") and bare-string alphabets
// passed to assert-bounded-fits / bounded-fits?. Named helpers (digits, etc.)
// are subsets of STANDARD_CHARS, so they need no special handling.
function extractAlphabetChars(source) {
  let chars = "";
  let m;
  const patterns = [
    /\(alphabet-of\s+"([^"]*)"\)/g,
    /\((?:assert-bounded-fits|bounded-fits\?)\s+"([^"]*)"/g,
  ];
  for (const p of patterns) {
    while ((m = p.exec(source)) !== null) chars += m[1];
  }
  return chars;
}

function boundedCharPairs(sources) {
  const fonts = new Set();
  let chars = STANDARD_CHARS;
  let any = false;
  for (const source of sources) {
    if (!usesBoundedForms(source)) continue;
    any = true;
    for (const f of extractFonts(source)) fonts.add(f);
    chars += extractAlphabetChars(source);
  }
  if (!any) return [];
  const uniqueChars = [...new Set([...chars])];
  const pairs = [];
  for (const font of fonts) {
    for (const ch of uniqueChars) {
      pairs.push({ text: ch, font });
    }
  }
  return pairs;
}

async function main() {
  const files = process.argv.slice(2).filter(f => !f.startsWith('-'));
  if (!files.length) {
    console.error('Usage: witness measure <file.shen> [file2.shen ...]');
    process.exit(1);
  }

  // Collect all text/font pairs from all files
  const allPairs = [];
  const sources = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    sources.push(source);
    const pairs = extractPairs(source);
    allPairs.push(...pairs);
  }

  // Tier 2: per-glyph measurements for any file using bounded forms.
  allPairs.push(...boundedCharPairs(sources));

  // Deduplicate
  const seen = new Set();
  const unique = allPairs.filter(p => {
    const key = `${p.text}\0${p.font}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (!unique.length) {
    console.log('No text/font pairs found to measure.');
    return;
  }

  // Check font availability and measure each pair
  const warnedFonts = new Set();
  for (const { font } of unique) {
    if (!warnedFonts.has(font) && !isFontAvailable(font)) {
      console.warn(`  WARNING: Font not available: ${font} — measurements may be inaccurate`);
      warnedFonts.add(font);
    }
  }

  const measurements = unique.map(({ text, font }) => {
    const width = measureText(text, font);
    return { text, font, width };
  });

  // Write .witness/measurements.shen
  const outDir = path.join(process.cwd(), '.witness');
  fs.mkdirSync(outDir, { recursive: true });

  const lines = measurements.map(m =>
    `  ["${m.text}" "${m.font}" ${m.width}]`
  );

  const output = `\\\\ Auto-generated by witness measure — do not edit
\\\\ ${new Date().toISOString()}

(set *measurements* [
${lines.join('\n')}
])
`;

  const outPath = path.join(outDir, 'measurements.shen');
  fs.writeFileSync(outPath, output);

  console.log(`  Measured ${measurements.length} text/font pairs`);
  for (const m of measurements) {
    console.log(`    "${m.text}" in ${m.font} = ${m.width.toFixed(2)}px`);
  }
  console.log(`  Wrote ${outPath}`);
}

main().catch(err => {
  console.error('measure failed:', err.message);
  process.exit(1);
});
