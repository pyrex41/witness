#!/usr/bin/env node
// vendor/fonts/woff-to-ttf.js — regenerate the vendored measurement TTF.
//
// Why this exists: boot.js pins JetBrains Mono for measurement parity, but
// node-canvas on Linux goes through pango/fontconfig, which cannot parse
// WOFF. registerFont(woff) fails SILENTLY there: measurements fall back to
// the system sans font while isFontAvailable still reports the pinned
// family as present — so witness "proves" bounds against the wrong glyph
// widths. A WOFF is just a zlib-wrapped sfnt (TTF), so we unwrap the exact
// fontsource file the repo already depends on and commit the result.
//
// Usage: node vendor/fonts/woff-to-ttf.js   (rewrites the .ttf next to it)

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function woffToTtf(woff) {
  if (woff.readUInt32BE(0) !== 0x774f4646) throw new Error('not a WOFF file');
  const flavor = woff.readUInt32BE(4);
  const numTables = woff.readUInt16BE(12);

  // WOFF table directory: 20-byte entries starting at offset 44
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const p = 44 + i * 20;
    const tag = woff.readUInt32BE(p);
    const offset = woff.readUInt32BE(p + 4);
    const compLength = woff.readUInt32BE(p + 8);
    const origLength = woff.readUInt32BE(p + 12);
    const origChecksum = woff.readUInt32BE(p + 16);
    const raw = woff.subarray(offset, offset + compLength);
    const data = compLength === origLength ? Buffer.from(raw) : zlib.inflateSync(raw);
    if (data.length !== origLength) throw new Error(`table ${i}: bad inflate length`);
    tables.push({ tag, origChecksum, data });
  }

  // sfnt header + directory
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = Math.pow(2, entrySelector) * 16;
  const sfntHeader = Buffer.alloc(12);
  sfntHeader.writeUInt32BE(flavor, 0);
  sfntHeader.writeUInt16BE(numTables, 4);
  sfntHeader.writeUInt16BE(searchRange, 6);
  sfntHeader.writeUInt16BE(entrySelector, 8);
  sfntHeader.writeUInt16BE(numTables * 16 - searchRange, 10);

  const dir = Buffer.alloc(numTables * 16);
  let offset = 12 + numTables * 16;
  const chunks = [];
  tables.forEach((t, i) => {
    dir.writeUInt32BE(t.tag, i * 16);
    dir.writeUInt32BE(t.origChecksum, i * 16 + 4);
    dir.writeUInt32BE(offset, i * 16 + 8);
    dir.writeUInt32BE(t.data.length, i * 16 + 12);
    const padded = t.data.length % 4 === 0
      ? t.data
      : Buffer.concat([t.data, Buffer.alloc(4 - (t.data.length % 4))]);
    chunks.push(padded);
    offset += padded.length;
  });

  return Buffer.concat([sfntHeader, dir, ...chunks]);
}

const src = require.resolve(
  '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'
);
const out = path.join(__dirname, 'jetbrains-mono-latin-400-normal.ttf');
fs.writeFileSync(out, woffToTtf(fs.readFileSync(src)));
console.log(`Wrote ${out} from ${src}`);
