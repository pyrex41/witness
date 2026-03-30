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

  // --- Text measurement (Pretext direct) ---
  // Returns intrinsic width of text in given font
  await $.define('textura.measure', (text, font) => {
    const prepared = prepareWithSegments(String(text), String(font));
    const result = layoutWithLines(prepared, 1e7, 20);
    return result.lines[0]?.width ?? 0;
  });

  // --- Layout engine (Textura: Yoga + Pretext) ---
  await $.define('textura.layout', (tree) => computeLayout(tree));

  // --- Textura tree builders (called from Shen, return JS objects) ---
  await $.define('textura-obj', (w, h, dir, gap, pad, justify, align, grow, shrink, children) => {
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
