// boot.js — ShenScript + Textura + Pretext bridge
// Polyfill OffscreenCanvas for Node.js (Pretext needs it for text measurement)
const { createCanvas, registerFont } = require('canvas');
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(w, h) { this._canvas = createCanvas(w, h); }
    getContext(type) { return this._canvas.getContext(type); }
  };
}

// Pin a known font for measurement parity. Without this, node-canvas measures
// text with whatever the host OS maps "monospace" to (Menlo on macOS, DejaVu
// on Linux, Consolas on Windows) — each with different glyph widths — while
// the browser may render something else entirely. Registering a specific
// font binary here and requiring callers to reference it by name makes the
// server and the browser measure the same shapes. The browser must load the
// same file via @font-face; the exported PINNED_FONT_FAMILY / PINNED_FONT_FILE
// helpers below let consumers do that without hardcoding paths.
const PINNED_FONT_FAMILY = 'JetBrains Mono';
const PINNED_FONT_FILE = require.resolve(
  '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff'
);
let fontRegistered = false;
function ensurePinnedFont() {
  if (fontRegistered) return;
  registerFont(PINNED_FONT_FILE, { family: PINNED_FONT_FAMILY });
  fontRegistered = true;
}
ensurePinnedFont();

const fs = require('fs');
const path = require('path');
const Shen = require('./vendor/shen-script/lib/shen.js');
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
  // Resolve relative shen paths against the package dir so that both the
  // top-level load and transitive `(load "shen/...")` calls inside witness.shen
  // find their files regardless of the caller's cwd. Absolute paths pass
  // through unchanged, so user code can still `$.load(absolutePath)`.
  const resolveShenPath = p => path.isAbsolute(p) ? p : path.join(__dirname, p);
  const $ = await new Shen({
    openRead: p => new InStream(resolveShenPath(p)),
    openWrite: p => new OutStream(resolveShenPath(p)),
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
    // Families we registered with node-canvas are guaranteed available even
    // when fontconfig doesn't know them (e.g. the fontsource woff we loaded
    // programmatically — fc-list only sees files under known font dirs).
    if (family === PINNED_FONT_FAMILY) return true;
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
  // Textura's ComputedLayout output only includes x/y/width/height/text/children/lineCount;
  // custom fields on the input are dropped. We zip two fields from the input text nodes
  // onto the output so the renderer can do visual clipping:
  //   - `overflow`  : the CSS overflow strategy ('ellipsis' | 'clip' | 'visible')
  //   - `clipWidth` : the author-declared MaxW. When > 0 we override output.width so
  //                   the rendered CSS width matches what the author asked for, even
  //                   though Yoga measured the text at intrinsic (unwrapped) width.
  function propagateMetadata(input, output) {
    if (!input || !output) return;
    if (input.className !== undefined) output.className = input.className;
    if (input.htmlTag !== undefined) output.htmlTag = input.htmlTag;
    if (input.href !== undefined) output.href = input.href;
    if (output.text !== undefined) {
      if (input.overflow !== undefined) output.overflow = input.overflow;
      if (typeof input.clipWidth === 'number' && input.clipWidth > 0) {
        output.width = input.clipWidth;
      }
      if (typeof input.font === 'string') output.font = input.font;
      if (typeof input.fontSize === 'number') output.fontSize = input.fontSize;
      if (typeof input.fontFamily === 'string') output.fontFamily = input.fontFamily;
      if (typeof input.lineHeight === 'number') output.lineHeight = input.lineHeight;
    }
    if (Array.isArray(input.children) && Array.isArray(output.children)) {
      const n = Math.min(input.children.length, output.children.length);
      for (let i = 0; i < n; i++) propagateMetadata(input.children[i], output.children[i]);
    }
  }
  // Pre-pin text widths to raw (unbuffered) Pretext measurements.
  //
  // Textura's MeasureFunc adds a 15% width buffer to every unsized text cell
  // to hide server/browser font divergence (see textura/dist/engine.js around
  // `bufferedWidth`). With a pinned font registered via canvas.registerFont
  // that divergence is gone — but the buffer remains, and it leaks into the
  // page as ~15% extra trailing whitespace on every cell (the "reuben .brooks"
  // gap we hit when three abutting proven cells rendered with 11px slack each).
  //
  // Patching the installed textura module is fragile; instead we sidestep the
  // buffer path. Textura's MeasureFunc has an unbuffered early-return when
  //   widthMode === Exactly && shouldWrap
  // (the wrap path: `return { width, height: layout(...).height }`). Any text
  // node with an explicit `width` and `whiteSpace: 'pre-wrap'` will hit that
  // branch. So: pre-measure with raw Pretext, set width to ceil(intrinsic),
  // flip whiteSpace. Since `maxWidth === intrinsic`, no wrap actually occurs;
  // the text lays out on one line as before, just without the 15% padding.
  function pinTextWidths(node) {
    if (!node) return;
    if (typeof node.text === 'string' && node.width == null) {
      try {
        const prepared = prepareWithSegments(node.text, node.font);
        const result = layoutWithLines(prepared, 1e7, node.lineHeight || 20);
        const intrinsic = result.lines[0]?.width ?? 0;
        // Round up so sub-pixel measurement noise can't cause a spurious wrap.
        node.width = Math.ceil(intrinsic);
        node.whiteSpace = 'pre-wrap';
      } catch (_) { /* measurement errored — let Textura handle it. */ }
    }
    if (Array.isArray(node.children)) {
      for (const c of node.children) pinTextWidths(c);
    }
  }
  await $.define('textura.layout', (tree) => {
    pinTextWidths(tree);
    const out = computeLayout(tree);
    propagateMetadata(tree, out);
    return out;
  });

  // Direct mutation helper for Shen — attaches a JS-side property to an
  // already-constructed textura input node. Used by `with-class` / `with-tag`
  // wrappers to decorate nodes without changing textura-obj's signature.
  await $.define('js.set-prop!', (obj, key, value) => {
    if (obj != null) obj[String(key)] = value;
    return obj;
  });

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

  // textura-text builds the Yoga input.
  //   - `width` is what Yoga uses for flex placement. Passing 0 means "unset"
  //     so Yoga measures intrinsically via Pretext — the correct default for
  //     any text we want rendered at its natural width. Pass a positive value
  //     only when the cell is truncating (ellipsis/clip) and needs a fixed
  //     cap independent of intrinsic measurement.
  //   - `clipWidth` is the displayed width at render time (e.g. for ellipsis).
  //     0 means no clipping; the renderer uses Yoga's computed width.
  //   - `overflow` is the CSS overflow strategy tag.
  await $.define('textura-text', (text, font, lineHeight, width, clipWidth, overflow) => {
    const f = String(font);
    const m = f.match(/^([\d.]+)(?:px)?\s+(.+)$/);
    const fontSize = m ? parseFloat(m[1]) : null;
    // lineHeight 0 = auto: scale with font-size for consistent descender room.
    const lh = lineHeight && lineHeight > 0
      ? lineHeight
      : (fontSize ? Math.ceil(fontSize * 1.4) : 20);
    const node = {
      text: String(text),
      font: f,
      fontSize,
      fontFamily: m ? m[2].trim() : f,
      lineHeight: lh,
      clipWidth,
      overflow: String(overflow),
    };
    // Only set width when caller explicitly wants a fixed cell. Otherwise
    // omit the key so Yoga's MeasureFunc runs Pretext on the string.
    if (width > 0) node.width = width;
    return node;
  });

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
  // Resolve relative to this file so the package works when installed as a
  // dependency, without requiring callers to chdir into witness's directory.
  if (!options.skipLoad) {
    await $.load(path.join(__dirname, 'shen/witness.shen'));
  }

  return $;
}

module.exports = { boot, PINNED_FONT_FAMILY, PINNED_FONT_FILE };
