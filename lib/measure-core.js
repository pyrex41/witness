// lib/measure-core.js — the single measurement oracle.
//
// Witness's guarantee is that a proven layout fits. That guarantee is only as
// good as the ruler, so there must be exactly ONE ruler with ONE policy. Before
// this module there were two:
//
//   cli/measure.js  — warned on an unavailable font and measured it anyway,
//                     then wrote the result into .witness/measurements.shen,
//                     which is the cache every `:verified` premise is
//                     discharged against.
//   boot.js         — threw on the same input.
//
// They disagreed by 40% on identical text ("Card Title" @ 20px JetBrains Mono:
// 85.96px vs 120px), and the proof cache carried the wrong one. Worse, both
// ended their measurement with `?? 0` — so a measurement FAILURE produced a
// width of zero, and a zero width makes every `fits?` obligation trivially
// true. A ruler that silently returns 0 is worse than no ruler at all.
//
// Policy here, applied to both callers:
//   - an unavailable font is FATAL, never a warning;
//   - a measurement that does not produce a line is FATAL, never 0;
//   - font specs are parsed once, correctly, including CSS shorthand.

// Pretext measures through a canvas 2D context, so Node needs the polyfill
// installed BEFORE pretext is required. Owning it here means every consumer
// measures in the same environment — boot.js and cli/measure.js each used to
// install their own copy.
const { createCanvas } = require('canvas');
if (typeof globalThis.OffscreenCanvas === 'undefined') {
  globalThis.OffscreenCanvas = class OffscreenCanvas {
    constructor(w, h) { this._canvas = createCanvas(w, h); }
    getContext(type) { return this._canvas.getContext(type); }
  };
}

const { prepareWithSegments, layoutWithLines } = require('@chenglou/pretext');

const GENERIC_FAMILIES = [
  'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
];

// Families registered programmatically with node-canvas by this process. These
// are invisible to fontconfig, so they must be tracked explicitly or
// isFontAvailable would reject the very fonts a project just supplied.
//
// A project registers its real faces through here (see registerProjectFonts) so
// proofs measure the glyphs that actually render. Without it a consuming app is
// stuck with generic families: witness refuses — correctly — to measure "Plus
// Jakarta Sans" with a substitute, so every contract would have to be written
// against sans-serif and would then describe something the browser never draws.
// For the medigap carrier corpus that gap is ~19% (PJS-600 490.7px vs
// sans-serif 467.8px on the same string), i.e. wide enough to pass text that
// overflows in production.
//
// WEIGHT: a canvas font shorthand's weight token is unreliable, and this
// module's grammar has no slot for one. Register each weight as its OWN family
// name ("Plus Jakarta Sans SemiBold" -> the 600 TTF) and reference that name in
// the font spec. One name, one file, no weight parsing anywhere.
const registeredFamilies = new Set();

/**
 * Register font files with node-canvas and mark their families available.
 * `fonts` is [{ family, file }]; `file` is resolved by the caller.
 * Idempotent per family. Returns the families registered.
 *
 * registerFont does NOT throw when it cannot parse a file — notably some .woff
 * files on some Linux node-canvas builds register as a silent no-op, after
 * which the "registered" family measures the fallback face instead. A ruler
 * that measures a font which never rendered is exactly the failure this module
 * exists to prevent, so each registration is verified: the family must measure
 * a probe string differently from the generic fallback it would otherwise use.
 * A face whose metrics happen to match the fallback exactly is indistinguishable
 * from a failed registration and cannot be trusted either way.
 */
function registerProjectFonts(fonts = []) {
  const { registerFont } = require('canvas');
  const PROBE = 'Wg1jploqy'; // ascenders, descenders, digits — width-distinctive
  const added = [];
  for (const { family, file } of fonts) {
    if (!family || !file) {
      throw new Error(`Font entry needs both "family" and "file": ${JSON.stringify({ family, file })}`);
    }
    if (registeredFamilies.has(family)) continue;
    if (!require('fs').existsSync(file)) {
      throw new Error(
        `Font file not found for "${family}": ${file}. Refusing to continue — a ` +
        'missing face would silently fall back and the measurement would not ' +
        'describe what renders.'
      );
    }
    // Measure the probe under the generic fallback BEFORE registering, so the
    // comparison afterwards isolates this face's effect.
    const fallbackWidth = rawMeasure(PROBE, '16px sans-serif');
    registerFont(file, { family });
    const registeredWidth = rawMeasure(PROBE, `16px ${family}`);
    if (registeredWidth === fallbackWidth) {
      throw new Error(
        `Font "${family}" (${file}) registered but measures identically to the ` +
        'sans-serif fallback, so node-canvas did not actually load it — this is ' +
        'the silent .woff failure mode. Use a TTF/OTF face. Refusing to measure ' +
        'against a font that never rendered.'
      );
    }
    registeredFamilies.add(family);
    added.push(family);
  }
  return added;
}

// Bare Pretext measurement with no availability policy — used only by
// registerProjectFonts' self-check, where "is this the fallback?" is precisely
// the question and measureText's availability guard would get in the way.
function rawMeasure(text, fontSpec) {
  const prepared = prepareWithSegments(String(text), canvasFontSpec(fontSpec));
  const width = layoutWithLines(prepared, 1e7, 20).lines[0]?.width;
  return typeof width === 'number' && Number.isFinite(width) ? width : NaN;
}

/**
 * Register the fonts a project declares in <projectRoot>/.witness/fonts.json:
 *
 *   [{ "family": "Plus Jakarta Sans SemiBold",
 *      "file": "node_modules/@expo-google-fonts/.../PlusJakartaSans_600SemiBold.ttf" }]
 *
 * `file` may be a path relative to projectRoot or a resolvable module path.
 * Absent manifest = no-op, so this is safe to call unconditionally. Every entry
 * point that measures calls it, so the ruler is configured identically whether
 * it is reached through boot(), the gates, or cli/measure.js.
 */
let loadedFontManifests = new Set();
function loadProjectFonts(projectRoot) {
  if (!projectRoot || loadedFontManifests.has(projectRoot)) return [];
  loadedFontManifests.add(projectRoot);
  const fsMod = require('fs');
  const pathMod = require('path');
  const manifest = pathMod.join(projectRoot, '.witness', 'fonts.json');
  if (!fsMod.existsSync(manifest)) return [];
  let entries;
  try {
    entries = JSON.parse(fsMod.readFileSync(manifest, 'utf8'));
  } catch (e) {
    throw new Error(`Could not parse ${manifest}: ${e.message}`);
  }
  if (!Array.isArray(entries)) {
    throw new Error(`${manifest} must be a JSON array of { family, file } objects.`);
  }
  return registerProjectFonts(entries.map(({ family, file }) => {
    let resolved = pathMod.isAbsolute(file) ? file : pathMod.join(projectRoot, file);
    if (!fsMod.existsSync(resolved)) {
      // Fall back to node resolution so a manifest can name a package path
      // directly without knowing where the install hoisted it.
      try {
        resolved = require.resolve(file, { paths: [projectRoot] });
      } catch (_) { /* keep the project-relative path so the error names it */ }
    }
    return { family, file: resolved };
  }));
}

// Families installed on the system, per fontconfig. `false` means fontconfig is
// unavailable, in which case only generics and explicitly pinned families count
// as available — see isFontAvailable.
let systemFamilies = null;
function loadSystemFamilies() {
  if (systemFamilies !== null) return systemFamilies;
  try {
    const { execSync } = require('child_process');
    const out = execSync('fc-list : family', { encoding: 'utf8', timeout: 5000 });
    systemFamilies = new Set(
      out.split('\n')
        .map(l => l.trim().toLowerCase())
        .filter(Boolean)
        .flatMap(l => l.split(',').map(f => f.trim()))
    );
  } catch (_) {
    systemFamilies = false;
  }
  return systemFamilies;
}

// CSS font shorthand: "<size>px[/<line-height>] <family>".
//
// The previous regexes (`/^[\d.]+px\s*/` for the family, and
// `/^([\d.]+)(?:px)?\s+(.+)$/` for the size) both ignored the `/<line-height>`
// clause. On "18px/1.2 sans-serif" — the Card contract's own title font — the
// first yielded the family "/1.2 sans-serif", which matches no installed font,
// and the second failed outright so fontSize became null and lineHeight
// silently fell back to 20. Every font the Card declares was affected.
const FONT_SPEC_RE = /^\s*([\d.]+)px(?:\s*\/\s*([\d.]+)(px)?)?\s+(.+?)\s*$/;

function parseFontSpec(spec) {
  const str = String(spec);
  const m = FONT_SPEC_RE.exec(str);
  if (!m) {
    throw new Error(
      `Unparseable font spec: ${JSON.stringify(str)}. ` +
      'Expected "<size>px[/<line-height>] <family>", e.g. "18px sans-serif" or "18px/1.2 sans-serif".'
    );
  }
  const size = parseFloat(m[1]);
  const family = m[4].trim();
  let lineHeight;
  if (m[2] === undefined) {
    lineHeight = Math.ceil(size * 1.4); // same default the renderers used
  } else if (m[3] === 'px') {
    lineHeight = parseFloat(m[2]);      // "18px/24px" — absolute
  } else {
    lineHeight = size * parseFloat(m[2]); // "18px/1.2" — multiplier, per CSS
  }
  return { size, family, lineHeight, spec: str };
}

function familyOf(spec) {
  return parseFontSpec(spec).family;
}

/**
 * A canvas-safe rendering of a font spec: "<size>px <family>".
 *
 * This is load-bearing, not cosmetic. A canvas 2D context accepts CSS font
 * shorthand but — per the HTML spec — only with `line-height: normal`. Assigning
 * a spec that carries any other line-height, such as "18px/1.2 sans-serif", is
 * INVALID, and an invalid assignment to ctx.font is silently IGNORED: the
 * context keeps whatever font it had. Pretext therefore measured the Card's
 * declared fonts using the previous font in that process — in a fresh process,
 * the canvas default of 10px sans-serif.
 *
 * The symptom was exact and reproducible: "Card Title" in "18px/1.2 sans-serif"
 * measured 42.978515625px, which is precisely 77.361328125 × 10/18 — the right
 * text at the wrong size. Widths came out ~44% under, so overflow checks passed
 * on text that does not fit. Stripping the line-height clause before measuring
 * makes the assignment valid; the line-height itself is returned separately by
 * parseFontSpec for layout to use.
 */
function canvasFontSpec(spec) {
  const { size, family } = parseFontSpec(spec);
  return `${size}px ${family}`;
}

function isGeneric(family) {
  return GENERIC_FAMILIES.includes(family.toLowerCase());
}

/**
 * Font availability. `opts.pinnedFamily` is a family registered programmatically
 * with node-canvas (fontconfig cannot see it, so it must be trusted explicitly).
 * `opts.systemFamilies` is a Set of lowercased families from fc-list, or false
 * when fontconfig is unavailable.
 *
 * When fontconfig is unavailable we return false (unknown => unavailable) rather
 * than guessing. The old heuristic — measure a probe string and compare against
 * three generics — reported a missing font as AVAILABLE whenever its fallback
 * metrics happened not to match any generic exactly, which is the wrong default
 * for something a proof depends on.
 */
function isFontAvailable(spec, opts = {}) {
  const family = familyOf(spec);
  if (opts.pinnedFamily && family === opts.pinnedFamily) return true;
  if (registeredFamilies.has(family)) return true;
  if (isGeneric(family)) return true;
  const sys = opts.systemFamilies !== undefined ? opts.systemFamilies : loadSystemFamilies();
  if (sys && typeof sys.has === 'function') return sys.has(family.toLowerCase());
  return false;
}

/**
 * Intrinsic width of `text` in `font`. Throws on an unavailable font and on a
 * measurement that yields no line — never returns a fallback number.
 */
function measureText(text, font, opts = {}) {
  const spec = String(font);
  if (!isFontAvailable(spec, opts)) {
    const family = familyOf(spec);
    throw new Error(
      `Font not available: "${family}". Install it, or use a generic family ` +
      '(sans-serif, serif, monospace). Refusing to measure with a substitute ' +
      'font: the resulting width would not describe what renders.'
    );
  }
  // Measure with the canvas-safe form — see canvasFontSpec for why passing the
  // raw shorthand silently measures at the wrong size.
  const prepared = prepareWithSegments(String(text), canvasFontSpec(spec));
  const result = layoutWithLines(prepared, 1e7, 20);
  const width = result.lines[0] && result.lines[0].width;
  if (typeof width !== 'number' || !Number.isFinite(width)) {
    throw new Error(
      `Measurement failed for ${JSON.stringify(String(text))} in ${JSON.stringify(spec)} ` +
      '(no line produced). Refusing to report a width of 0 — that would make ' +
      'every fits? obligation trivially true.'
    );
  }
  return width;
}

module.exports = {
  GENERIC_FAMILIES,
  registerProjectFonts,
  loadProjectFonts,
  registeredFamilies,
  parseFontSpec,
  familyOf,
  isGeneric,
  isFontAvailable,
  measureText,
  canvasFontSpec,
};
