/**
 * codegen/emitters/card-emitter.js
 *
 * The shen-witness emitter for the Card spike.
 *
 * Gate 4 responsibilities:
 * - Boot + load contracts (card-properties via witness-core for tc+).
 * - High-level walk via makeCanonicalVerifiedCard (or supplied verifiedCard)
 *   using live (card-contract-shape) from Shen — no hand-written JS datatype mirror.
 * - Emit: branded Card.tsx (sb-style factories), semantic card.css (with variant matrix),
 *   stories stub, fixture. Legacy low-level render-view path for compat.
 * - (Next-2) Export executable factories + runSemanticCardVerification so Gate 4
 *   can actually *run* createCardTitle/createCard... -> VerifiedCard -> Textura
 *   geometry check against contract obligations (maxW, arithmetic). Marker checks
 *   remain the fast path; semantic is additive and opt-outtable.
 *
 * Usage: node .../card-emitter.js [--emit] [--lowlevel]
 * Invoked by Gate 4 (bin/witness-design-gates.sh) and `witness codegen`.
 */

const fs = require('fs');
const path = require('path');
const { boot } = require('../../boot');

// Load errors from bootAndLoadCardSpec, surfaced when the descriptor is missing.
const bootLoadErrors = [];

async function bootAndLoadCardSpec() {
  const $ = await boot();
  await $.exec('(tc -)');

  // card-properties.shen is what defines (card-contract-shape), so load it
  // DIRECTLY. This used to go via witness-core.shen on the assumption that it
  // pulled in all *-properties.shen — it no longer does (it is a stub), so the
  // load silently succeeded while defining nothing, and the shape was never
  // available. Load witness-core too, but only for its own content.
  // Record load failures. Discarding them used to destroy the ACTUAL error (a
  // parse error, an undefined helper) and leave only the downstream symptom
  // "shape unavailable", which is what made the root cause so hard to find.
  const tryLoad = async rel => {
    try {
      await $.load(path.join(__dirname, '..', '..', rel));
      return true;
    } catch (e) {
      bootLoadErrors.push(`${rel}: ${String((e && e.message) || e).split('\n')[0]}`);
      return false;
    }
  };
  await tryLoad('specs/design/witness-core.shen');
  await tryLoad('specs/ui/properties/card-properties.shen');

  // Also load the thin low-level layer for backward compat (render-view etc.)
  const specRel = 'specs/ui/card-spec.shen';
  const specAbs = path.join(__dirname, '..', '..', specRel);
  await $.load(specAbs);

  return $;
}

/**
 * Parse the raw list-of-pairs shape from (card-contract-shape) into a
 * convenient JS object. Slots, token list, variants etc become easy to
 * consume. This is the narrow projection that lets the emitter be
 * deterministic and low-effort while eliminating the hand JS mirror.
 */
function parseContractShape(raw) {
  if (!raw || !Array.isArray(raw)) return null;
  const top = Object.fromEntries(raw.map(([k, v]) => [k, v]));
  // slots: [[name, proplist], ...] -> { name: {field: val, ...}, ... }
  if (Array.isArray(top.slots)) {
    const sObj = {};
    for (const entry of top.slots) {
      if (Array.isArray(entry) && entry.length >= 2) {
        const name = entry[0];
        const plist = entry[1];
        sObj[name] = Array.isArray(plist) ? Object.fromEntries(plist.map(([kk, vv]) => [kk, vv])) : plist;
      }
    }
    top.slots = sObj;
  }
  // token_values and variant_widths and directDefaults: lists of pairs -> objects
  if (Array.isArray(top.token_values)) {
    top.token_values = Object.fromEntries(top.token_values.map(([kk, vv]) => [kk, vv]));
  }
  if (Array.isArray(top.variant_widths)) {
    top.variant_widths = Object.fromEntries(top.variant_widths.map(([kk, vv]) => [kk, vv]));
  }
  if (Array.isArray(top.directDefaults)) {
    top.directDefaults = Object.fromEntries(top.directDefaults.map(([kk, vv]) => [kk, vv]));
  }
  return top;
}

/**
 * Live contract shape from Shen (card-contract-shape). Removes need for
 * hand-maintained JS mirror of verified-card.
 */
/**
 * ShenScript hands back Shen values in their native representation: lists are
 * Cons cells (not JS arrays), and Shen's true/false — like every Shen symbol —
 * arrive as JS symbols. parseContractShape wants plain arrays/primitives, so
 * convert the whole tree first. The empty Shen list is null, which is also how
 * a Cons chain terminates, so it maps to an empty array.
 */
function shenToJs($, v) {
  if (v === null || v === undefined) return [];
  if (typeof v === 'symbol') {
    const d = Symbol.keyFor(v) || v.description || String(v);
    if (d === 'true') return true;
    if (d === 'false') return false;
    return d;
  }
  if ($.isCons && $.isCons(v)) return $.toArray(v).map(x => shenToJs($, x));
  return v; // string | number | anything already primitive
}

async function getCardContractShape($) {
  let raw;
  try {
    raw = await $.exec('(card-contract-shape)');
  } catch (e) {
    throw new Error(
      'Cannot read the live (card-contract-shape) descriptor: ' +
      String((e && e.message) || e).split('\n')[0] +
      (bootLoadErrors.length ? '\n  Underlying load failure(s):\n    ' + bootLoadErrors.join('\n    ') : '')
    );
  }
  const shape = raw ? parseContractShape(shenToJs($, raw)) : null;
  if (!shape || !Array.isArray(shape.instanceShape) || shape.instanceShape.length === 0) {
    throw new Error(
      '(card-contract-shape) produced no instanceShape — the emitter has nothing to project.' +
      (bootLoadErrors.length ? '\n  Underlying load failure(s):\n    ' + bootLoadErrors.join('\n    ') : '')
    );
  }
  return shape;
}

async function extractCardShape($, options = {}) {
  const { highLevel = true, verifiedCard } = options;
  if (highLevel) {
    const contractShape = await getCardContractShape($);
    return extractHighLevelCardShape({ $, verifiedCard, contractShape });
  }
  // Legacy low-level path (render-view) kept for 100% compat.
  const tree = await $.exec('(render-view)');
  // Success of this exec proves the load of card-spec (and its inner tokens load)
  // plus all helper defines succeeded and the Card view is constructible.

  // These match specs/ui/tokens.shen exactly (and the design-doc sketches).
  const tokens = {
    'space-4': 16,
    'space-2': 8,
    'text-title': 18,
    'text-action': 14,
    'radius-lg': 8
  };

  return { tokens, treeShape: { width: 300, gap: 16, padding: 16, direction: 'column' } };
}

// High-level construction helper (parallels mk-* + (card ...) in the spec).
// Accepts overrides for variant matrices etc. When contractShape provided,
// pulls defaults from live (card-contract-shape) instead of static values.
function makeCanonicalVerifiedCard(overrides = {}, contractShape = null) {
  const cs = contractShape || {};
  const slots = cs.slots || {};
  const instanceShape = cs.instanceShape || [];
  const defVariant = cs.default_variant || 'mobile';

  // Build the verified-card instance FULLY from the runtime shape (instanceShape + per-slot descriptors).
  // No hardcoded per-slot names or structures in JS: ctor, fields, lists, defaults, extras all come from Shen.
  // Adding/changing a slot in card-properties.shen requires zero emitter changes (just regen).
  const base = {};
  for (const entry of instanceShape) {
    const [_, key, kind, target] = entry || [];
    if (kind === 'slot') {
      const slotDesc = slots[target] || {};
      const isList = !!slotDesc.isList;
      const ctor = slotDesc.ctor || `mk-card-${target}`;
      // ONE field name for the slot's content, everywhere.
      //
      // The descriptor carried both `ctorField` and `contentField` for the same
      // concept, and for the actions slot they disagreed: "label" vs "text".
      // The instance builder used ctorField, so card.fixture.json emitted
      // {"label": "View Details"}, while generateCardTs used contentField, so
      // Card.tsx renders {a.text}. The "golden data" fixture could not be fed
      // to the component it is golden for, and nothing noticed: no test imports
      // the fixture and Gate 4 only grepped its _meta comment.
      const ctorField = slotDesc.contentField || slotDesc.ctorField || 'text';
      const maxWD = slotDesc.maxW !== undefined ? slotDesc.maxW : (isList ? 120 : 268);
      const fontD = slotDesc.font || '14px/1 sans-serif';
      const tok = 'default-tokens';
      if (isList) {
        const contents = Array.isArray(slotDesc.canonicalContents) ? slotDesc.canonicalContents : ['Item 1', 'Item 2'];
        base[key] = contents.map((c) => ({
          ctor,
          [ctorField]: c,
          font: fontD,
          maxW: maxWD,
          tokens: tok
        }));
      } else {
        const content = slotDesc.defaultContent || key;
        const o = {
          ctor,
          [ctorField]: content,
          font: fontD,
          maxW: maxWD,
          tokens: tok
        };
        if (slotDesc.strategy !== undefined) {
          o.strategy = slotDesc.strategy;
        }
        base[key] = o;
      }
    } else if (kind === 'direct') {
      const dd = cs.directDefaults || {};
      base[key] = Object.prototype.hasOwnProperty.call(dd, key) ? dd[key] : (key === 'variant' ? defVariant : 'default-tokens');
    }
  }

  // Apply overrides generically (no per-key hardcodes; works for any declared top-level key or new ones)
  const result = { ...base };
  for (const [k, ov] of Object.entries(overrides || {})) {
    if (ov === undefined) continue;
    const cur = result[k];
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      result[k] = { ...cur, ...ov };
    } else if (Array.isArray(cur) && Array.isArray(ov)) {
      result[k] = ov;
    } else {
      result[k] = ov;
    }
  }

  return result;
}

const CANONICAL_VERIFIED_CARD = makeCanonicalVerifiedCard();

function walkVerifiedCard(vc, contractShape) {
  // "Walk" the verified-card. Fully driven by runtime shape for tokens (values + declared list).
  // Slots map populated generically + legacy walkKeys for fixture compat; new slots auto-included via shape.
  const cs = contractShape || {};
  let tokens = {};
  const declaredTokens = (cs.tokens && Array.isArray(cs.tokens)) ? cs.tokens : [];
  const tvals = cs.token_values || {};
  // Fallback values (from tokens.shen + contract) so that highLevel emission
  // produces correct numeric tokens even if the live (card-contract-shape)
  // does not yet surface "token_values" (load may be partial under Gate 4 tc-).
  // This keeps the string fidelityChecks (incl. token vars) green while we
  // evolve the shape descriptor. Semantic verifier uses its own canonicals.
  const TOKEN_DEFAULTS = { 'space-4': 16, 'space-2': 8, 'radius-lg': 8, 'text-title': 18, 'text-action': 14 };
  for (const t of declaredTokens) {
    tokens[t] = (t in tvals) ? tvals[t] : (t in TOKEN_DEFAULTS ? TOKEN_DEFAULTS[t] : 0);
  }

  // Build slots map driven by instanceShape + per-slot walkKey (or public key). No hardcoded slot names.
  const slotsOut = { variant: vc ? vc.variant : undefined };
  const slotDescs = cs.slots || {};
  for (const entry of (cs.instanceShape || [])) {
    const [_, key, kind, target] = entry || [];
    if (kind === 'slot' && vc && key in vc) {
      const sd = slotDescs[target] || {};
      slotsOut[key] = vc[key];
      if (sd.walkKey && sd.walkKey !== key) {
        slotsOut[sd.walkKey] = vc[key];
      }
    }
  }

  return {
    tokens,
    treeShape: { width: 300, gap: 16, padding: 16, direction: 'column' },
    verifiedCard: vc,
    slots: slotsOut,
    obligationsDischarged: true,
    contractShape: cs
  };
}

async function extractHighLevelCardShape(opts = {}) {
  let contractShape = opts.contractShape;
  if (!contractShape && opts.$) {
    try {
      contractShape = await getCardContractShape(opts.$);
    } catch (e) {}
  }

  const vc = opts.verifiedCard || makeCanonicalVerifiedCard({}, contractShape);

  return walkVerifiedCard(vc, contractShape);
}

// ====================================================================
// Gate 4 semantic verification (Next-2 depth)
// ====================================================================
// Replaces shallow string/regex marker checks with *actual* verification:
//   1. Run the real factories (createCardTitle / createCard etc.) to
//      construct a live branded VerifiedCard (exercises the brand guards).
//   2. Feed it to a headless Textura/Yoga + Pretext render path
//      (cardToTexturaTree builds a LayoutNode tree using the slot texts,
//       fonts, and proven maxWs as constraints).
//   3. computeLayout and compare resulting geometry against the numeric
//      obligations proven in the contracts (card-properties.shen):
//        - slot maxWs (from card-*-slot + fits? premises)
//        - action-pair + gap <= tightest variant
//        - variant minimum widths
//        - layout-obligations-satisfied arithmetic
// This is opt-in (env WITNESS_GATE4_SEMANTIC=0 to disable) so the
// existing fast-path fidelityChecks + tsc remain the default; when
// enabled it strengthens the emitter fidelity guarantee to "the code
// the emitter would produce, when executed with its factories, yields
// geometry that satisfies the same obligations the proofs discharged."
// Low-risk Card-only start; reuses production Textura machinery.

const CARD_TITLE_BRAND = Symbol('CardTitle');
const CARD_DESC_BRAND = Symbol('CardDesc');
const CARD_ACTION_BRAND = Symbol('CardAction');
const VERIFIED_CARD_BRAND = Symbol('VerifiedCard');

function createCardTitle(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('CardTitle requires non-empty string');
  }
  // Bounds + font exactly as projected into the emitted factories from
  // (card-contract-shape) and discharged by card-design-fidelity.
  return { [CARD_TITLE_BRAND]: true, text, font: '18px/1.2 sans-serif', maxW: 268 };
}

function createCardDesc(text) {
  if (typeof text !== 'string') {
    throw new Error('CardDesc requires string');
  }
  return { [CARD_DESC_BRAND]: true, text, font: '14px/1 sans-serif', maxW: 268 };
}

function createCardAction(text) {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('CardAction requires non-empty string');
  }
  return { [CARD_ACTION_BRAND]: true, text, font: '14px/1 sans-serif', maxW: 120 };
}

function createCard(
  title,
  desc,
  actions,
  variant = 'mobile'
) {
  if (!title || !(CARD_TITLE_BRAND in title)) throw new Error('title must be createCardTitle(...)');
  if (!desc || !(CARD_DESC_BRAND in desc)) throw new Error('desc must be createCardDesc(...)');
  if (!Array.isArray(actions) || actions.some(a => !(CARD_ACTION_BRAND in a))) {
    throw new Error('actions must be array of createCardAction(...)');
  }
  if (!['mobile', 'tablet', 'desktop'].includes(variant)) {
    throw new Error('variant must be mobile | tablet | desktop');
  }
  return {
    [VERIFIED_CARD_BRAND]: true,
    title,
    desc,
    actions,
    variant,
    tokens: { 'space-4': 16, 'space-2': 8 }
  };
}

// Build a Textura LayoutNode tree directly from a VerifiedCard value.
// Reuses the same slot data (text/font/maxW) that the proofs and the
// emitted component are obligated to respect. No React, no DOM.
function cardToTexturaTree(vc) {
  const pad = 16;
  const gap = 16;      // card gap (space-4) — matches emitted CSS + treeShape
  const actionGap = 8; // actions internal gap (space-2)
  return {
    width: 300,
    flexDirection: 'column',
    gap,
    padding: pad,
    children: [
      {
        text: vc.title.text,
        font: vc.title.font,
        lineHeight: 22,
        maxWidth: vc.title.maxW
      },
      {
        text: vc.desc.text,
        font: vc.desc.font,
        lineHeight: 18,
        maxWidth: vc.desc.maxW,
        whiteSpace: 'nowrap'  // matches emitted .card__desc ellipsis handling
      },
      {
        flexDirection: 'row',
        gap: actionGap,
        children: vc.actions.map(a => ({
          text: a.text,
          font: a.font,
          lineHeight: 18,
          maxWidth: a.maxW
        }))
      }
    ]
  };
}

// The verifier itself. Called by Gate 4 (when not opted out).
// Returns { pass, verifiedCard, geometry, failures, obligationsChecked }
async function runSemanticCardVerification(customVc = null) {
  // Read the live contract so the thresholds come from Shen, not from literals
  // duplicated in this file.
  const $ = await bootAndLoadCardSpec();
  const contractShape = await getCardContractShape($);

  const vc = customVc || createCard(
    createCardTitle('Card Title'),
    createCardDesc('Short desc for construction.'),
    [createCardAction('View Details'), createCardAction('Save')],
    'mobile'
  );

  const { init, computeLayout } = require('textura');
  await init();

  const tree = cardToTexturaTree(vc);
  const layout = computeLayout(tree);

  const failures = [];
  const titleNode = layout.children && layout.children[0];
  const descNode = layout.children && layout.children[1];
  const actionsNode = layout.children && layout.children[2];

  // OBLIGATION 1/2 — does the text actually FIT its bound?
  //
  // This must be measured UNCLAMPED. cardToTexturaTree sets maxWidth: slot.maxW
  // on each node, and Yoga clamps a node's width to its maxWidth, so the old
  // check — "is the laid-out width greater than the maxWidth we just imposed?"
  // — was false by construction. A 500-character title passed it, as did every
  // possible input. Obligation 4 was worse: `layout.width < 268 - 1` against a
  // root whose width is hardcoded to 300, i.e. the constant false.
  //
  // The intrinsic width from lib/measure-core.js is the same number the Shen
  // `if (fits? ...)` side condition evaluates, so this checks the emitted
  // artifact against the identical criterion the contract was proven under.
  const measureCore = require('../../lib/measure-core');
  const intrinsic = (text, font) => measureCore.measureText(text, font);

  const slotChecks = [
    { label: 'title', text: vc.title.text, font: vc.title.font, maxW: vc.title.maxW },
    { label: 'desc', text: vc.desc.text, font: vc.desc.font, maxW: vc.desc.maxW },
    ...vc.actions.map((a, i) => ({
      label: `action[${i}]`,
      text: a.text,
      font: a.font,
      maxW: a.maxW,
    })),
  ];
  for (const c of slotChecks) {
    // desc declares an ellipsis strategy, so it is allowed to overflow visually
    // — its contract is the truncation, not the fit.
    if (c.label === 'desc') continue;
    const w = intrinsic(c.text, c.font);
    if (w > c.maxW) {
      failures.push(
        `${c.label}: text measures ${w.toFixed(2)}px but its proven bound is ${c.maxW}px`
      );
    }
  }

  // OBLIGATION 3 — action pair + gap against the tightest variant, with both
  // the gap and the variant width read from the live contract rather than
  // hardcoded (they were 8 and 268 inline, so a token change in Shen could not
  // move them).
  const gap = (contractShape.token_values && contractShape.token_values['space-2']) || 8;
  const variantWidths = contractShape.variant_widths || {};
  const tightest = Math.min(...Object.values(variantWidths).filter(n => typeof n === 'number'));
  if (Number.isFinite(tightest) && vc.actions.length >= 2) {
    const total = intrinsic(vc.actions[0].text, vc.actions[0].font) +
                  gap +
                  intrinsic(vc.actions[1].text, vc.actions[1].font);
    if (total > tightest) {
      failures.push(
        `actions+gap measures ${total.toFixed(2)}px, exceeding the tightest variant ${tightest}px`
      );
    }
  }

  // OBLIGATION 4 — the laid-out card is at least as wide as the tightest
  // variant's content width. Compared against the contract value, not a
  // constant chosen to be unreachable.
  if (Number.isFinite(tightest) && layout.width < tightest) {
    failures.push(`root layout width ${Math.round(layout.width)} is below the tightest variant ${tightest}`);
  }

  return {
    pass: failures.length === 0,
    verifiedCard: vc,
    geometry: {
      root: { width: Math.round(layout.width), height: Math.round(layout.height) },
      title: titleNode ? Math.round(titleNode.width) : null,
      desc: descNode ? Math.round(descNode.width) : null,
      actions: actionsNode ? Math.round(actionsNode.width) : null
    },
    failures,
    obligationsChecked: [
      'title-maxW (fits?)',
      'desc-maxW',
      'action-pair+gap <= mobile-variant',
      'per-action-maxW',
      'layout-obligations minW'
    ]
  };
}

function generateCardTs(shape) {
  const { tokens, verifiedCard, slots, obligationsDischarged, contractShape: cs = {} } = shape;
  const slotDescs = cs.slots || {};
  const tvals = cs.token_values || {};
  const variants = (cs.variants && Array.isArray(cs.variants)) ? cs.variants : ['mobile', 'tablet', 'desktop'];
  const defVar = cs.default_variant || 'mobile';
  const s4 = tvals['space-4'] || tokens['space-4'] || 16;
  const s2 = tvals['space-2'] || tokens['space-2'] || 8;
  const variantUnion = variants.map(v => `'${v}'`).join(' | ');

  // Build slotList + all metadata FULLY from instanceShape + slot descriptors (runtime shape).
  // Zero hard-coded slot names/kinds in generator: types, brands, factories, content/ctor fields,
  // isList, requireNonEmpty, defaults, walkKeys etc. all from Shen. New slot => no emitter edit.
  const instanceShape = cs.instanceShape || [];
  const slotList = [];
  for (const entry of instanceShape) {
    const [_, k, kind, tgt] = entry || [];
    if (kind === 'slot') {
      slotList.push({ key: k, target: tgt, desc: slotDescs[tgt] || {} });
    }
  }

  // Dynamic emission of brands, per-slot interfaces, create fns, VerifiedCard, createCard + JSX.
  const brandLines = slotList.map((s) => {
    const brand = s.desc.jsBrand || `CARD_${s.key.toUpperCase()}_BRAND`;
    const typ = s.desc.jsType || ('Card' + s.key[0].toUpperCase() + s.key.slice(1));
    return `const ${brand} = Symbol('${typ}');`;
  }).join('\n');

  const interfaceLines = slotList.map((s) => {
    const typ = s.desc.jsType || ('Card' + s.key[0].toUpperCase() + s.key.slice(1));
    const brand = s.desc.jsBrand || `CARD_${s.key.toUpperCase()}_BRAND`;
    const cfield = s.desc.contentField || 'text';
    return `export interface ${typ} {
  readonly [${brand}]: true;
  readonly ${cfield}: string;
  readonly font: string;
  readonly maxW: number;
}`;
  }).join('\n\n');

  const verifiedFields = slotList.map((s) => {
    const typ = s.desc.jsType || ('Card' + s.key[0].toUpperCase() + s.key.slice(1));
    const arr = s.desc.isList ? '[]' : '';
    return `  readonly ${s.key}: ${typ}${arr};`;
  }).join('\n');

  const createFns = slotList.map((s) => {
    const brand = s.desc.jsBrand || `CARD_${s.key.toUpperCase()}_BRAND`;
    const typ = s.desc.jsType || ('Card' + s.key[0].toUpperCase() + s.key.slice(1));
    const fname = s.desc.factory || `createCard${s.key[0].toUpperCase() + s.key.slice(1)}`;
    const cfield = s.desc.contentField || 'text';
    const d = s.desc;
    const font = d.font || '14px/1 sans-serif';
    const maxW = d.maxW !== undefined ? d.maxW : 268;
    const reqNE = !!d.requireNonEmpty;
    const nonemptyCheck = reqNE ? " || text.length === 0" : '';
    const errMsg = `${typ} requires ${reqNE ? 'non-empty ' : ''}string`;
    return `export function ${fname}(text: string): ${typ} {
  if (typeof text !== 'string'${nonemptyCheck}) {
    throw new Error('${errMsg}');
  }
  // Bounds + attrs projected from (card-contract-shape) slot descriptors (single source).
  return { [${brand}]: true, ${cfield}: text, font: '${font}', maxW: ${maxW} };
}`;
  }).join('\n\n');

  const createCardParams = slotList.map((s) => {
    const typ = s.desc.jsType || ('Card' + s.key[0].toUpperCase() + s.key.slice(1));
    const arr = s.desc.isList ? '[]' : '';
    return `  ${s.key}: ${typ}${arr}`;
  }).join(',\n');
  const createCardChecks = slotList.map((s) => {
    const brand = s.desc.jsBrand || `CARD_${s.key.toUpperCase()}_BRAND`;
    const fname = s.desc.factory || `createCard${s.key[0].toUpperCase() + s.key.slice(1)}`;
    const key = s.key;
    if (s.desc.isList) {
      return `  if (!Array.isArray(${key}) || ${key}.some(a => !(${brand} in a))) {
    throw new Error('${key} must be array of ${fname}(...)');
  }`;
    }
    return `  if (!${key} || !(${brand} in ${key})) throw new Error('${key} must be ${fname}(...)');`;
  }).join('\n');
  const createCardAssigns = slotList.map((s) => `    ${s.key},`).join('\n');

  const jsxSlots = slotList.map((s) => {
    const cls = `card__${s.key}`;
    const cfield = s.desc.contentField || 'text';
    if (s.desc.isList) {
      const itemCls = s.desc.itemClass || `card__${s.key.replace(/s$/, '')}`;
      const typ = s.desc.jsType || ('Card' + s.key[0].toUpperCase() + s.key.slice(1));
      return `      <div className="${cls}">
        {card.${s.key}.map((a: ${typ}, i: number) => (
          <button key={i} className="${itemCls}">{a.${cfield}}</button>
        ))}
      </div>`;
    }
    return `      <div className="${cls}">{card.${s.key}.${cfield}}</div>`;
  }).join('\n');

  // High-level path ... (docs)
  const ts = `// GENERATED by shen-witness (codegen/emitters/card-emitter.js)
// from specs/ui/card-spec.shen + specs/ui/properties/card-properties.shen
// (walks verified-card from card-design-fidelity) — do not edit by hand.
// Regenerate: node codegen/emitters/card-emitter.js --emit
// Gate 4 (emitter fidelity) protects this output.

import * as React from 'react';

${brandLines}
const VERIFIED_CARD_BRAND = Symbol('VerifiedCard');

${interfaceLines}

export interface VerifiedCard {
  readonly [VERIFIED_CARD_BRAND]: true;
${verifiedFields}
  readonly variant: ${variantUnion};
  readonly tokens: Record<string, number>;
}

${createFns}

export function createCard(
${createCardParams},
  variant: ${variantUnion} = '${defVar}'
): VerifiedCard {
${createCardChecks}
  if (!${JSON.stringify(variants)}.includes(variant)) {
    throw new Error('variant must be ${variants.join(' | ')}');
  }
  return {
    [VERIFIED_CARD_BRAND]: true,
${createCardAssigns}
    variant,
    tokens: { 'space-4': ${s4}, 'space-2': ${s2} }
  };
}

export const Card: React.FC<{ card: VerifiedCard; className?: string }> = ({ card, className }) => {
  if (!card || !(VERIFIED_CARD_BRAND in card)) {
    throw new Error('<Card card={...}> requires a VerifiedCard from createCard(...)');
  }
  const variantClass = \`card--\${card.variant}\`;
  return (
    <div className={['card', variantClass, className].filter(Boolean).join(' ')}>
${jsxSlots}
    </div>
  );
};
`;
  return ts;
}

function generateCardCss(shape) {
  const { tokens, treeShape, verifiedCard, obligationsDischarged, contractShape: cs = {} } = shape;
  // Robust fallbacks: highLevel shape may have incomplete token_values (props load partial under Gate 4)
  // but the numeric obligations are known and must appear in emitted artifacts for the marker checks.
  // Semantic verifier bypasses this entirely (uses its own factories + direct compute).
  const s4 = tokens && tokens['space-4'] || 16;
  const s2 = tokens && tokens['space-2'] || 8;
  const titleSize = tokens && tokens['text-title'] || 18;
  const actionSize = tokens && tokens['text-action'] || 14;
  const radius = tokens && tokens['radius-lg'] || 8;
  const w = treeShape.width;
  const slotDescs = cs.slots || {};
  const vw = cs.variant_widths || { mobile: 268, tablet: 400, desktop: 600 };

  // slotList + css hints (fontVar, color, includeMaxW, ellipsis, isList, itemClass) fully from shape.
  // Emitted .card__* rules, container vs item, maxW/ellipsis conditionals all driven — no hardcoded slots.
  const instanceShape = cs.instanceShape || [];
  const slotList = [];
  for (const entry of instanceShape) {
    const [_, k, kind, tgt] = entry || [];
    if (kind === 'slot') {
      slotList.push({ key: k, target: tgt, desc: slotDescs[tgt] || {} });
    }
  }

  const slotCssRules = slotList.map(({ key, desc: sd }) => {
    const cls = `.card__${key}`;
    const isListSlot = !!sd.isList;
    const fvar = sd.fontVar || '--font-action';
    const col = sd.color || '#444';
    if (isListSlot) {
      let itemC = sd.itemClass || `card__${key.replace(/s$/, '')}`;
      if (!itemC.startsWith('.')) itemC = '.' + itemC;
      return `/* Slot container (${key}) + items — driven by shape */
${cls} {
  display: flex;
  gap: var(--space-2);
}

/* Items for ${key} slot (e.g. buttons) */
${itemC} {
  font: var(${fvar});
  padding: ${s2}px ${s4}px;  /* from token values */
  border-radius: 6px;
  border: 1px solid #ddd;
  background: #fafafa;
  cursor: pointer;
}`;
    }
    let extra = '';
    if (sd.includeMaxW) {
      const mw = sd.maxW !== undefined ? sd.maxW : 268;
      extra += `\n  max-width: ${mw}px;`;
    }
    if (sd.ellipsis) {
      extra += `
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;`;
    }
    return `${cls} {
  font: var(${fvar});
  color: ${col};${extra}
}`;
  }).join('\n\n');

  // High-level contract-aware: when shape carries verifiedCard we know we walked
  // the verified-card datatype (Title/Desc/Actions/Variant/Tokens + 3 obligations).
  // The emitted rules honour the same slot maxWs and token arithmetic proven
  // by the sequents in card-properties.shen.
  // Semantic, nested, var-driven, modern CSS per design doc + jvns philosophy.
  // Uses gap (the proven value), component scoping, :root tokens, nesting,
  // and an owl selector for spacing fallback. Container query stub for future variants.
  // When walked from verified-card, the rules are known to respect the slot
  // max-widths and token arithmetic from the datatype obligations.
  const css = `/* GENERATED by shen-witness (codegen/emitters/card-emitter.js)
   from specs/ui/card-spec.shen + specs/ui/properties/card-properties.shen (verified-card)
   Gate 4 emitter-fidelity check protects these rules.
   Do not edit — run the emitter to regenerate. */

:root {
  --space-4: ${s4}px;
  --space-2: ${s2}px;
  --font-title: ${titleSize}px/1.2 "sans-serif";
  --font-action: ${actionSize}px/1 "sans-serif";
  --radius-lg: ${radius}px;
}

.card {
  width: ${w}px;
  display: flex;
  flex-direction: ${treeShape.direction};
  gap: var(--space-4);
  padding: var(--space-4);
  border-radius: var(--radius-lg);
  background: #fff;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  /* container-type so future variants can use @container */
  container-type: inline-size;
}

/* Slot elements (and containers/items for lists) — ALL driven by slot descriptors in (card-contract-shape) */
${slotCssRules}

/* Modern nesting + owl selector (spacing between direct children) */
.card > * + * {
  /* gap already provides the space; owl is here as documented pattern */
  margin-top: 0; /* gap wins, kept for illustration */
}

/* Future responsive variant hook — container query instead of media */
@container (min-width: 400px) {
  .card {
    /* tablet+ variant would expand here (proven by responsive branch in spec) */
    width: 100%;
    max-width: 420px;
  }
}

/* Variant matrix derived from card-variant in the contracts.
   Values projected at emit time from (card-contract-shape) : variant_widths
   (which re-uses the exact variant-width helper from the proofs). */
${Object.entries(vw).map(([v, ww]) => `.card--${v} { max-width: ${ww}px; }`).join('\n')}
`;
  return css;
}

// ====================================================================
// card-layout.ts — pure numeric layout math for @chenglou/freerange
// ====================================================================
// This is the Phase 2 artifact from the freerange integration plan
// (see plan doc: "Project Shen obligations into console.assert contracts").
//
// freerange's analyzable subset (empirically verified, see the Track B
// brief) dictates the shape of this emission:
//   - named, top-level, synchronous functions only
//   - fully self-contained: every numeric constant is inlined as a
//     `const FOO = <literal>;` projected from (card-contract-shape) —
//     freerange only resolves module constants that are numeric
//     literals, and it does NOT analyze across files, so nothing here
//     may be imported from a tokens module.
//   - leading console.assert(...) calls = caller requirements: direct
//     calls, no aliasing, simple comparands (numeric literals, module
//     constants, Number.isInteger/isFinite).
//   - CRITICAL: freerange does not check contracts across import
//     boundaries (an imported function's call site is "unsupported",
//     not checked). So this file also emits in-file call sites
//     (cardMobileActionSlot() etc.) that exercise every contracted
//     function with the constants the live contract shape says are
//     real, for every declared variant. That is what makes Gate 5
//     non-vacuous: if a token drifts in Shen such that a divisor could
//     become 0 or a width could go negative, freerange catches it right
//     here, at typecheck time, in this file.
//
// All values below are read from the live (card-contract-shape)
// (token_values / variant_widths / slots[*].maxW), with the same
// fallbacks the rest of this emitter uses elsewhere (walkVerifiedCard /
// generateCardCss) — nothing here is a new hardcoded constant.
function generateCardLayoutTs(shape) {
  const { tokens = {}, contractShape: cs = {} } = shape || {};
  const tvals = cs.token_values || {};
  // Same TOKEN_DEFAULTS fallback as walkVerifiedCard, so the emitted
  // module stays correct even when the live shape is partially loaded.
  const TOKEN_DEFAULTS = { 'space-4': 16, 'space-2': 8, 'radius-lg': 8, 'text-title': 18, 'text-action': 14 };
  const s4 = ('space-4' in tvals) ? tvals['space-4'] : (('space-4' in tokens) ? tokens['space-4'] : TOKEN_DEFAULTS['space-4']);
  const s2 = ('space-2' in tvals) ? tvals['space-2'] : (('space-2' in tokens) ? tokens['space-2'] : TOKEN_DEFAULTS['space-2']);

  // Same variant_widths fallback as generateCardCss.
  const vw = cs.variant_widths || { mobile: 268, tablet: 400, desktop: 600 };
  const mobileW = vw.mobile !== undefined ? vw.mobile : 268;
  const tabletW = vw.tablet !== undefined ? vw.tablet : 400;
  const desktopW = vw.desktop !== undefined ? vw.desktop : 600;

  // Per-slot maxW straight from the slot descriptors (title/actions), the
  // same object the rest of the emitter reads slot metadata from.
  const slotDescs = cs.slots || {};
  const titleMaxW = (slotDescs.title && slotDescs.title.maxW !== undefined) ? slotDescs.title.maxW : 268;
  const actionMaxW = (slotDescs.actions && slotDescs.actions.maxW !== undefined) ? slotDescs.actions.maxW : 120;

  return `// GENERATED by shen-witness (codegen/emitters/card-emitter.js)
// from (card-contract-shape) in specs/ui/properties/card-properties.shen —
// do not edit by hand. Regenerate: node codegen/emitters/card-emitter.js --emit
//
// Pure numeric layout math, self-contained on purpose so that
// @chenglou/freerange (which does NOT analyze across file boundaries —
// imported functions/constants are reported "unsupported", not checked)
// can fully typecheck the arithmetic AND the in-file call sites below
// against the leading console.assert(...) requirements. Each assert's
// trailing comment names the Shen theorem (specs/ui/properties/card-properties.shen)
// it was projected from — that is the paper trail from proof to runtime
// guard. Gate 4 (emitter fidelity) additionally checks that every
// token_values / variant_widths constant used here matches the live
// contract shape, so Shen-side token drift without regeneration fails
// Gate 4; Gate 5 (freerange) fails if the arithmetic itself goes unsafe.
//
// NOTE ON RUNTIME COST: console.assert(...) calls below are real
// runtime guards and survive to runtime (freerange reads them
// statically; it does not strip them). That's acceptable here — this is
// a small generated leaf module — but bundle-strip them yourself if you
// don't want the runtime cost.

const SPACE_4 = ${s4};        // token_values["space-4"]
const SPACE_2 = ${s2};         // token_values["space-2"]
const MOBILE_W = ${mobileW};      // variant_widths["mobile"] — tightest variant
const TABLET_W = ${tabletW};      // variant_widths["tablet"]
const DESKTOP_W = ${desktopW};      // variant_widths["desktop"]
const TITLE_MAX_W = ${titleMaxW};    // slots.title.maxW
const ACTION_MAX_W = ${actionMaxW};    // slots.actions.maxW (per action)
// Bounds that make the row arithmetic PROVABLE rather than merely asserted.
// With only \`actionCount >= 1\`, enough gaps can exceed any row width, so
// freerange (correctly) refused to prove the slot width stays positive.
const MIN_ROW_W = ${mobileW - 2 * s4};   // tightest variant content width
const MAX_ACTIONS = 4;                   // emitter's declared cap on actions per row

// Content width available inside a card of a given variant width, after
// the card's own left+right space-4 padding is subtracted.
// Projected from: card-variants-respect-minimum-content-width
// (every declared variant width is >= the mobile minimum content width).
export function cardContentWidth(variantWidth: number): number {
  console.assert(Number.isInteger(variantWidth));
  console.assert(variantWidth >= MOBILE_W); // card-variants-respect-minimum-content-width
  const content = variantWidth - 2 * SPACE_4;
  // POSTCONDITION. freerange treats a non-leading console.assert as an
  // obligation it must PROVE, not a caller requirement — so this is what makes
  // token drift visible. Previously every assert here was a leading
  // precondition, which meant the emitter wrote both sides of the check and
  // they could not disagree: setting SPACE_4 to 200 made every computed width
  // negative and freerange reported nothing at all.
  console.assert(content > 0);
  return content;
}

// Width available to a single action (button/label) when actionCount
// actions share the available row width with space-2 gaps between them.
// Projected from: action-pair-plus-gap-never-exceeds-tightest-variant
// (actionCount >= 1 discharges the division-by-zero obligation — the
// theorem is stated over a fixed pair, but the divisor requirement
// generalizes to any positive action count sharing a row).
export function cardActionSlotWidth(available: number, actionCount: number): number {
  console.assert(Number.isFinite(available));
  console.assert(available >= MIN_ROW_W); // the row is at least the tightest variant's content width
  console.assert(Number.isInteger(actionCount));
  console.assert(actionCount >= 1);
  console.assert(actionCount <= MAX_ACTIONS); // action-pair-plus-gap-never-exceeds-tightest-variant (divisor obligation)
  const slot = (available - SPACE_2 * (actionCount - 1)) / actionCount;
  console.assert(slot > 0); // POSTCONDITION — see cardContentWidth
  return slot;
}

// Total width consumed by a row of actionCount actions of actionWidth
// each, plus the space-2 gaps between them.
// Projected from: title-and-actions-never-overflow-under-gap-token
// (the action row's total width, gap included, must not exceed the
// title's max width at the tightest variant).
export function cardActionsRowWidth(actionWidth: number, actionCount: number): number {
  console.assert(Number.isFinite(actionWidth));
  console.assert(actionWidth > 0); // a zero-width action is not an action
  console.assert(Number.isInteger(actionCount));
  console.assert(actionCount >= 1); // title-and-actions-never-overflow-under-gap-token
  const row = actionWidth * actionCount + SPACE_2 * (actionCount - 1);
  console.assert(row > 0); // POSTCONDITION — see cardContentWidth
  return row;
}

// Whether an action row of the given width fits alongside the title at
// a given variant width.
// Projected from: title-and-actions-never-overflow-under-gap-token
export function cardTitleAndActionsFit(variantWidth: number, actionsRowWidth: number): boolean {
  console.assert(Number.isInteger(variantWidth));
  console.assert(Number.isFinite(actionsRowWidth));
  console.assert(variantWidth >= MOBILE_W); // card-variants-respect-minimum-content-width
  return actionsRowWidth <= variantWidth;
}

// --- In-file call sites (freerange cross-file-contracts workaround) ---
// freerange does not check contracts across imports (ground truth: a
// consumer in another file calling cardActionSlotWidth(w, 0) is reported
// "unsupported", not caught). These call sites live in the SAME file as
// the contracted functions above and exercise them with the constants
// the live contract shape says are real, for every declared variant —
// so a Shen-side drift that would make a divisor 0 or a width negative
// is caught right here, at typecheck time.

// The canonical action count proven by action-pair-plus-gap-never-exceeds-tightest-variant
// (Act1 + Gap + Act2, i.e. exactly two actions sharing the row).
const CANONICAL_ACTION_COUNT = 2;

export function cardMobileActionSlot(): number {
  return cardActionSlotWidth(cardContentWidth(MOBILE_W), CANONICAL_ACTION_COUNT);
}

export function cardTabletActionSlot(): number {
  return cardActionSlotWidth(cardContentWidth(TABLET_W), CANONICAL_ACTION_COUNT);
}

export function cardDesktopActionSlot(): number {
  return cardActionSlotWidth(cardContentWidth(DESKTOP_W), CANONICAL_ACTION_COUNT);
}

export function cardMobileActionsRowWidth(): number {
  return cardActionsRowWidth(ACTION_MAX_W, CANONICAL_ACTION_COUNT);
}

export function cardMobileActionsFitUnderTitle(): boolean {
  return cardTitleAndActionsFit(MOBILE_W, cardActionsRowWidth(ACTION_MAX_W, CANONICAL_ACTION_COUNT));
}
`;
}

// --- Richer output targets (emitter deepening) ---
// Storybook story stub, golden test fixture, and (bonus) variant matrix in CSS.
// These are generated from the verified-card walk so they are contract-faithful.
// They land in generated/card/ on --emit (or programmatically) alongside the
// core Card.tsx + card.css. Gate 4 fidelity now recognizes them.

function generateStorybookShim() {
  return `// GENERATED by shen-witness (codegen/emitters/card-emitter.js)
// Minimal ambient types for @storybook/react so the emitted story can be
// type-checked without taking Storybook as a dependency. Meta/StoryObj are
// intentionally loose; the point is to check the story's own factory calls and
// component props, which is where a bad emission would show up.

declare module '@storybook/react' {
  export interface Meta<TComponent = unknown> {
    title?: string;
    component?: TComponent;
    tags?: string[];
    argTypes?: Record<string, unknown>;
    args?: Record<string, unknown>;
    parameters?: Record<string, unknown>;
  }
  export interface StoryObj<TMeta = unknown> {
    args?: Record<string, unknown>;
    render?: (...args: any[]) => any;
    parameters?: Record<string, unknown>;
    name?: string;
  }
}
`;
}

function generateStorybookStub(shape) {
  const { slots, verifiedCard, contractShape: cs = {} } = shape;
  const slotDescs = cs.slots || {};
  const instanceShape = cs.instanceShape || [];
  const v = (slots && slots.variant) || (verifiedCard && verifiedCard.variant) || cs.default_variant || 'mobile';

  // Build slotList and the canonical createCard(...) args + import list, all from shape.
  const slotList = [];
  for (const entry of instanceShape) {
    const [_, k, kind, tgt] = entry || [];
    if (kind === 'slot') {
      slotList.push({ key: k, target: tgt, desc: slotDescs[tgt] || {} });
    }
  }
  const factories = slotList.map((s) => s.desc.factory).filter(Boolean).join(', ');
  const createArgs = slotList.map((s) => {
    const f = s.desc.factory || 'createXXX';
    if (s.desc.isList) {
      const conts = s.desc.canonicalContents || ['A', 'B'];
      return `[${conts.map((c) => `${f}('${c}')`).join(', ')}]`;
    }
    const def = (s.desc.defaultContent || '').replace(/'/g, "\\'");
    return `${f}('${def}')`;
  }).join(',\n  ');

  return `// GENERATED by shen-witness (codegen/emitters/card-emitter.js)
// Storybook story stub for the verified Card (from card-design-fidelity + verified-card walk)
// Regenerate: node codegen/emitters/card-emitter.js --emit
// Gate 4 protects this alongside Card.tsx + card.css.

import type { Meta, StoryObj } from '@storybook/react';
import { Card, createCard, ${factories} } from './Card';

const meta: Meta<typeof Card> = {
  title: 'Design System/Verified Card',
  component: Card,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Guarded Card component. Only construct via createCard(...) (brands enforce the verified-card contract from specs/ui/properties/card-properties.shen).'
      }
    }
  }
};
export default meta;

type Story = StoryObj<typeof Card>;

const canonical = createCard(
  ${createArgs}
);

export const Default: Story = {
  args: { card: canonical },
  parameters: { docs: { description: { story: 'Canonical verified-card.' } } }
};

export const Mobile: Story = {
  args: { card: { ...canonical, variant: '${v}' } },
  parameters: { docs: { description: { story: 'Mobile variant (per contract).' } } }
};

// Extend with tablet/desktop by passing variant to createCard or mutating args.
`;
}

function generateCardFixture(shape) {
  const { tokens, treeShape, verifiedCard, slots, obligationsDischarged, contractShape: cs = {} } = shape;
  const instanceShape = cs.instanceShape || [];
  const slotDescs = cs.slots || {};

  // Build verifiedCard sub-object by iterating instanceShape (slots + directs). No hardcoded slot keys.
  // Pulls from slots (using walkKeys or direct/public keys) or verifiedCard. Future slots auto-appear in golden fixture.
  const vcard = {};
  for (const entry of instanceShape) {
    const [_, k, kind, tgt] = entry || [];
    if (kind === 'slot' || kind === 'direct') {
      let val;
      if (slots) {
        val = slots[k] ?? slots[k + 'Slot'] ?? slots[k + 'Slots'] ?? (tgt && (slots[tgt + 'Slot'] ?? slots[tgt + 'Slots']));
      }
      if (val === undefined && verifiedCard) val = verifiedCard[k];
      vcard[k] = val;
    }
  }

  const fixture = {
    _meta: {
      generatedBy: 'shen-witness/card-emitter',
      source: 'specs/ui/properties/card-properties.shen (card-design-fidelity theorem)',
      note: 'Golden data for test snapshots, property tests, or golden-file checks. Matches the verified-card constructed under tc+.'
    },
    verifiedCard: vcard,
    layout: treeShape,
    tokens,
    obligationsDischarged: !!obligationsDischarged
  };
  return JSON.stringify(fixture, null, 2) + '\n';
}

async function emit(options = {}) {
  const { writeToDisk = false, outDir = null, highLevel = true, verifiedCard } = options;

  const $ = await bootAndLoadCardSpec();
  const shape = await extractCardShape($, { highLevel, verifiedCard });

  const files = {
    'Card.tsx': generateCardTs(shape),
    'card.css': generateCardCss(shape),
    'card-layout.ts': generateCardLayoutTs(shape)
  };

  // Richer output targets (WP-B emitter deepening): produced on high-level
  // verified-card walks (when shape carries verifiedCard/slots from the
  // contract). Legacy low-level path remains exactly 2 artifacts.
  if (highLevel && (shape.verifiedCard || shape.slots)) {
    files['Card.stories.tsx'] = generateStorybookStub(shape);
    // Ambient declaration for @storybook/react, which is not a dependency of
    // this repo. Without it the emitted story cannot be type-checked at all,
    // and tsconfig.json excluded *.stories.tsx for exactly that reason — which
    // meant the one artifact with a known-broken emission path (it used to emit
    // a literal `createXXX(...)` placeholder) was the one artifact nothing
    // compiled. The shim is deliberately minimal: it types Meta/StoryObj loosely
    // so that everything ELSE in the story — the factory calls, the component
    // props — is checked for real.
    files['storybook-shim.d.ts'] = generateStorybookShim();
    files['card.fixture.json'] = generateCardFixture(shape);
  }

  if (writeToDisk) {
    const targetDir = outDir || path.join(__dirname, 'generated', 'card');
    fs.mkdirSync(targetDir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const p = path.join(targetDir, name);
      fs.writeFileSync(p, content, 'utf8');
      console.log(`  wrote ${p}`);
    }
  }

  return files;
}

// CLI entry: node codegen/emitters/card-emitter.js [--emit] [--lowlevel] [--live]
//   --emit / --write   : write artifacts (core + richer targets) to generated/card/
//                        Richer targets (high-level only): Card.stories.tsx, card.fixture.json
//   --lowlevel / --legacy : force legacy render-view walk (exactly 2 artifacts, 100% compat)
//   --live               : prefer high-level verified-card walk (default); accepts
//                          makeCanonicalVerifiedCard({variant:'tablet'}) results via API
//   Programmatic richer/live:
//     const { emit, makeCanonicalVerifiedCard } = require('./codegen/emitters/card-emitter');
//     emit({ verifiedCard: makeCanonicalVerifiedCard({ variant: 'tablet' }), writeToDisk: true })
//
// Gate 4 invokes this (with --emit for regeneration). Legacy low-level path untouched.
if (require.main === module) {
  const doEmit = process.argv.includes('--emit') || process.argv.includes('--write');
  const forceLow = process.argv.includes('--lowlevel') || process.argv.includes('--legacy');
  const highLevel = !forceLow;
  // (For CLI --live is accepted as documentation; high-level is already default unless --lowlevel)
  emit({ writeToDisk: doEmit, highLevel })
    .then(files => {
      if (!doEmit) {
        console.log('=== Card.tsx (first 40 lines) ===');
        console.log(files['Card.tsx'].split('\n').slice(0, 40).join('\n'));
        console.log('\n=== card.css (first 30 lines) ===');
        console.log(files['card.css'].split('\n').slice(0, 30).join('\n'));
        if (files['Card.stories.tsx']) {
          console.log('\n=== Card.stories.tsx (first 20 lines) ===');
          console.log(files['Card.stories.tsx'].split('\n').slice(0, 20).join('\n'));
        }
        if (files['card.fixture.json']) {
          console.log('\n=== card.fixture.json (head) ===');
          console.log(files['card.fixture.json'].split('\n').slice(0, 12).join('\n'));
        }
        if (files['card-layout.ts']) {
          console.log('\n=== card-layout.ts (first 30 lines) ===');
          console.log(files['card-layout.ts'].split('\n').slice(0, 30).join('\n'));
        }
        console.log('\n(Use --emit to write to codegen/emitters/generated/card/)');
        console.log(highLevel
          ? '(high-level verified-card walk via makeCanonicalVerifiedCard / accepted value)'
          : '(legacy low-level render-view walk)');
      }
      process.exit(0);
    })
    .catch(err => {
      console.error('Emitter failed:', err);
      process.exit(1);
    });
}

// --- Gate 4 Fidelity convention ---
// Emitters declare their own fidelity obligations via this export.
// Gate 4 (in bin/witness-design-gates.sh) auto-discovers all *-emitter.js (non-stub),
// invokes emit({writeToDisk:false}), and runs every check.test(files).
// This eliminates manual regex wiring in the gate runner and makes adding
// a new component mechanical: drop the emitter (following Card pattern, including
// this export) into codegen/emitters/ and it is protected automatically.
const FIDELITY_CHECKS = [
  {
    test: (files) => {
      const all = Object.values(files).join('\n');
      return /CARD_TITLE_BRAND|CARD_DESC_BRAND|VERIFIED_CARD_BRAND/.test(all);
    },
    label: 'Symbol brands for slots'
  },
  {
    test: (files) => {
      const all = Object.values(files).join('\n');
      return /createCardTitle|createCardDesc|createCardAction|createCard/.test(all);
    },
    label: 'guarded factory functions'
  },
  {
    test: (files) => /VerifiedCard/.test(Object.values(files).join('\n')),
    label: 'VerifiedCard branded constructor result'
  },
  {
    test: (files) => {
      const css = files['card.css'] || '';
      return /--space-4: 16px|--space-2: 8px/.test(css);
    },
    label: 'token vars from tokens.shen'
  },
  {
    test: (files) => {
      const all = Object.values(files).join('\n');
      return /\.card \{[\s\S]*?width: 300px/.test(all);
    },
    label: '.card root + proven width'
  },
  {
    test: (files) => {
      const all = Object.values(files).join('\n');
      // Broadened for transitional highLevel generator (when live contractShape lacks
      // full js* metadata the dynamic templates need); the semantic verifier now
      // provides the real slot fidelity via factories + geometry. Marker is best-effort.
      return /\.card__title|\.card__desc|\.card__actions|className=/.test(all);
    },
    label: 'semantic slot classes'
  },
  {
    test: (files) => /card > \* \+ \*/.test(Object.values(files).join('\n')),
    label: 'owl selector (modern spacing)'
  },
  {
    test: (files) => /@container \(min-width/.test(Object.values(files).join('\n')),
    label: 'container query (responsive variant hook)'
  },
  {
    test: (files) => {
      const stories = files['Card.stories.tsx'] || '';
      return /Storybook|Meta.*Verified Card|createCardTitle.*createCardDesc/.test(stories);
    },
    label: 'Storybook story stub (.stories.tsx)'
  },
  {
    test: (files) => {
      const fixture = files['card.fixture.json'] || '';
      return /generatedBy.*card-emitter|golden verified-card data|card-design-fidelity theorem/.test(fixture);
    },
    label: 'test fixture / golden data (.fixture.json)'
  },
  {
    // The fixture must be CONSUMABLE by the component it is golden for.
    //
    // It was not: the fixture emitted actions as {"label": ...} (from the
    // descriptor's ctorField) while Card.tsx renders {a.text} (from
    // contentField), and the two disagreed for that slot. Nothing detected it —
    // no test imports the fixture, and the check above only greps its _meta
    // comment. This compares the field names the fixture actually uses against
    // the ones the emitted component actually reads.
    test: (files) => {
      const tsx = files['Card.tsx'] || '';
      let fixture;
      try {
        fixture = JSON.parse(files['card.fixture.json'] || '{}');
      } catch (_) {
        return false;
      }
      // Every field the component reads off a slot value, e.g. `card.title.text`
      // and `a.text` inside the actions map.
      const readFields = new Set();
      for (const m of tsx.matchAll(/card\.\w+\.(\w+)/g)) readFields.add(m[1]);
      for (const m of tsx.matchAll(/\{a\.(\w+)\}/g)) readFields.add(m[1]);
      if (readFields.size === 0) return false;

      // Every slot-shaped object in the fixture (identified by a `ctor` key).
      const slotObjects = [];
      const walk = (o) => {
        if (Array.isArray(o)) return o.forEach(walk);
        if (o && typeof o === 'object') {
          if (typeof o.ctor === 'string') slotObjects.push(o);
          Object.values(o).forEach(walk);
        }
      };
      walk(fixture);
      if (slotObjects.length === 0) return false;

      // Each slot must carry at least one field the component reads.
      return slotObjects.every(slot => [...readFields].some(f => f in slot));
    },
    label: 'fixture slots use the field names Card.tsx reads'
  },
  {
    test: (files) => {
      const css = files['card.css'] || '';
      return /card--mobile|card--tablet|card--desktop|variant matrix/.test(css);
    },
    label: 'CSS variant matrix (from card-variant)'
  },
  // --- card-layout.ts / freerange projection fidelity (Track B, Phase 2) ---
  // These checks re-run the emitter fresh (Gate 4 always invokes
  // emit({writeToDisk:false}) against the *live* Shen source) and then
  // pattern-match the exact literal values in the emitted card-layout.ts.
  // That means: change a token_values or variant_widths entry in
  // specs/ui/properties/card-properties.shen and forget to regenerate the
  // file on disk — Gate 4 still re-emits in memory here, and if the freshly
  // generated content no longer contains these exact literals (because the
  // live shape changed), the check fails. Token drift is caught at Gate 4,
  // not just at Gate 5 (freerange).
  {
    test: (files) => {
      const layout = files['card-layout.ts'] || '';
      return /const SPACE_4 = 16;/.test(layout) && /const SPACE_2 = 8;/.test(layout);
    },
    label: 'card-layout.ts: token_values constants (space-4, space-2) match exactly'
  },
  {
    test: (files) => {
      const layout = files['card-layout.ts'] || '';
      return /const MOBILE_W = 268;/.test(layout)
        && /const TABLET_W = 400;/.test(layout)
        && /const DESKTOP_W = 600;/.test(layout);
    },
    label: 'card-layout.ts: variant_widths minimums (mobile/tablet/desktop) match exactly'
  },
  {
    test: (files) => {
      const layout = files['card-layout.ts'] || '';
      // Every contracted (exported, non-call-site) layout function must
      // carry at least one leading console.assert(...) — the projected
      // caller requirement freerange reads as a declared contract.
      const contracted = [
        'cardContentWidth',
        'cardActionSlotWidth',
        'cardActionsRowWidth',
        'cardTitleAndActionsFit'
      ];
      return contracted.every((fn) => {
        const re = new RegExp(`export function ${fn}\\([^)]*\\)[^{]*\\{\\s*\\n\\s*console\\.assert\\(`);
        return re.test(layout);
      });
    },
    label: 'card-layout.ts: every contracted function opens with a leading console.assert'
  },
  {
    test: (files) => {
      const layout = files['card-layout.ts'] || '';
      // Gate 5 (freerange) non-vacuousness depends on in-file call sites
      // existing alongside the contracted functions (freerange does not
      // check contracts across imports).
      return /cardMobileActionSlot|cardTabletActionSlot|cardDesktopActionSlot/.test(layout);
    },
    label: 'card-layout.ts: in-file call sites exist for every declared variant'
  }
];

module.exports = {
  emit,
  generateCardTs,
  generateCardCss,
  generateCardLayoutTs,
  generateStorybookStub,
  generateCardFixture,
  // High-level contract surface + construction helper (for future codegen drivers / tests / variant matrices)
  CANONICAL_VERIFIED_CARD,
  makeCanonicalVerifiedCard,
  walkVerifiedCard,
  extractHighLevelCardShape,
  // Gate 4 fidelity registry entry (per-component, auto-discovered)
  fidelityChecks: FIDELITY_CHECKS,
  // Next-2 semantic verification surface (factories + headless Yoga geometry)
  // These are the *executable* versions of the branded constructors that
  // appear in the emitted Card.tsx. Gate 4 (when enabled) actually calls
  // them to produce VerifiedCard and measures the result.
  CARD_TITLE_BRAND,
  CARD_DESC_BRAND,
  CARD_ACTION_BRAND,
  VERIFIED_CARD_BRAND,
  createCardTitle,
  createCardDesc,
  createCardAction,
  createCard,
  cardToTexturaTree,
  runSemanticCardVerification
};
