// boot.js — ShenScript + Textura + Pretext bridge
// Polyfill OffscreenCanvas for Node.js (Pretext needs it for text measurement)
const { createCanvas } = require('canvas');
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(w, h) { this._canvas = createCanvas(w, h); }
    getContext(type) { return this._canvas.getContext(type); }
  };
}

const fs = require('fs');
const Shen = require('shen-script');
const { init, computeLayout } = require('textura');
const { prepareWithSegments, layoutWithLines } = require('@chenglou/pretext');

// File I/O streams for ShenScript's `load` function
class InStream {
  constructor(path) { this._buf = fs.readFileSync(path); this._pos = 0; }
  read() { return this._pos < this._buf.length ? this._buf[this._pos++] : -1; }
  close() { this._buf = null; }
}

class OutStream {
  constructor(path) { this._fd = fs.openSync(path, 'w'); }
  write(byte) { fs.writeSync(this._fd, Buffer.from([byte])); }
  close() { fs.closeSync(this._fd); }
}

async function boot(options = {}) {
  const $ = await new Shen({
    openRead: path => new InStream(path),
    openWrite: path => new OutStream(path),
    InStream,
    OutStream,
  });
  await init();

  // --- Font availability detection ---
  // Uses fontconfig (fc-list) when available for authoritative font detection.
  // Falls back to width-comparison heuristic in browser environments.
  const fontCache = new Map();
  let systemFontFamilies = null;

  function loadSystemFonts() {
    if (systemFontFamilies !== null) return;
    try {
      const { execSync } = require('child_process');
      const output = execSync('fc-list : family', { encoding: 'utf8', timeout: 5000 });
      systemFontFamilies = new Set(
        output.split('\n')
          .map(l => l.trim().toLowerCase())
          .filter(Boolean)
          .flatMap(l => l.split(',').map(f => f.trim()))
      );
    } catch (_) {
      systemFontFamilies = false; // fontconfig not available
    }
  }

  function isFontAvailable(fontSpec) {
    // Generic CSS font families are always "available"
    const generics = ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui'];
    const family = fontSpec.replace(/^[\d.]+px\s*/, '').trim();
    if (generics.includes(family.toLowerCase())) return true;
    if (fontCache.has(family)) return fontCache.get(family);

    loadSystemFonts();
    let available;
    if (systemFontFamilies) {
      available = systemFontFamilies.has(family.toLowerCase());
    } else {
      // Fallback: heuristic width comparison against multiple generics
      const probe = 'mmmmmmmmmmlli';
      const wTest = layoutWithLines(prepareWithSegments(probe, fontSpec), 1e7, 20).lines[0]?.width ?? 0;
      const wSans = layoutWithLines(prepareWithSegments(probe, fontSpec.replace(/[^0-9px ]+$/, 'sans-serif')), 1e7, 20).lines[0]?.width ?? 0;
      const wSerif = layoutWithLines(prepareWithSegments(probe, fontSpec.replace(/[^0-9px ]+$/, 'serif')), 1e7, 20).lines[0]?.width ?? 0;
      const wMono = layoutWithLines(prepareWithSegments(probe, fontSpec.replace(/[^0-9px ]+$/, 'monospace')), 1e7, 20).lines[0]?.width ?? 0;
      // If width matches any generic exactly, font is likely missing
      available = Math.abs(wTest - wSans) > 0.01 &&
                  Math.abs(wTest - wSerif) > 0.01 &&
                  Math.abs(wTest - wMono) > 0.01;
    }
    fontCache.set(family, available);
    return available;
  }

  await $.define('textura.font-available?', (font) =>
    $.asShenBool(isFontAvailable(String(font))));

  // --- Text measurement (Pretext direct) ---
  // Returns intrinsic width of text in given font.
  // Warns (but does not error) if font is unavailable — measurements use the fallback.
  await $.define('textura.measure', (text, font) => {
    const fontStr = String(font);
    if (!isFontAvailable(fontStr)) {
      const family = fontStr.replace(/^[\d.]+px\s*/, '').trim();
      throw new Error(`Font not available: "${family}". Install it or use a system font (sans-serif, serif, monospace).`);
    }
    const prepared = prepareWithSegments(String(text), fontStr);
    const result = layoutWithLines(prepared, 1e7, 20);
    return result.lines[0]?.width ?? 0;
  });

  // --- Layout engine (Textura: Yoga + Pretext) ---
  await $.define('textura.layout', (tree) => computeLayout(tree));

  // --- Textura tree builders (called from Shen, return JS objects) ---
  await $.define('textura-obj', (w, h, dir, gap, pad, justify, align, grow, shrink, margin, flexWrap, minW, maxW, minH, children) => {
    const node = {};
    if (w > 0) node.width = w;
    if (h > 0) node.height = h;
    if (dir) node.flexDirection = String(dir);
    if (gap > 0) node.gap = gap;
    if (pad > 0) node.padding = pad;
    if (justify) node.justifyContent = String(justify);
    if (align) node.alignItems = String(align);
    if (grow > 0) node.flexGrow = grow;
    if (shrink > 0) node.flexShrink = shrink;
    if (margin > 0) node.margin = margin;
    if (flexWrap) node.flexWrap = String(flexWrap);
    if (minW > 0) node.minWidth = minW;
    if (maxW > 0) node.maxWidth = maxW;
    if (minH > 0) node.minHeight = minH;
    node.children = $.toArray(children);
    return node;
  });

  await $.define('textura-text', (text, font, lineHeight, maxW) => ({
    text: String(text),
    font: String(font),
    lineHeight: lineHeight,
    width: maxW
  }));

  await $.define('textura-box', (w, h) => ({ width: w, height: h }));

  // --- DOM interop (browser-only) ---
  if (typeof document !== 'undefined') {
    await $.define('dom.create-element', (tag) => document.createElement(String(tag)));
    await $.define('dom.set-style', (el, styles) => {
      Object.assign(el.style, styles);
      return el;
    });
    await $.define('dom.set-text', (el, t) => { el.textContent = String(t); return el; });
    await $.define('dom.append', (p, c) => { p.appendChild(c); return p; });
    await $.define('dom.get-by-id', (id) => document.getElementById(String(id)));
    await $.define('dom.clear', (el) => { el.innerHTML = ''; return el; });
    await $.define('dom.on', (el, evt, fn) => {
      el.addEventListener(String(evt), (e) => $.caller(fn)(e));
      return el;
    });
    await $.define('dom.raf', (fn) => {
      requestAnimationFrame(() => $.caller(fn)());
      return null;
    });
  }

  // --- JS interop helpers ---
  await $.define('js.undefined?', (x) => $.asShenBool(x === undefined));

  // --- Math helpers ---
  await $.define('math.ceil', (x) => Math.ceil(x));
  await $.define('math.floor', (x) => Math.floor(x));

  // --- JSON (ShenScript already provides json.parse and json.str) ---
  // No additional registration needed

  // --- HTTP ---
  await $.define('http.fetch', async (url, opts) => {
    const r = await fetch(String(url), opts);
    return { status: r.status, body: await r.json() };
  });

  // --- Load Shen modules ---
  if (!options.skipLoad) {
    await $.load('shen/witness.shen');
  }

  return $;
}

module.exports = { boot };
