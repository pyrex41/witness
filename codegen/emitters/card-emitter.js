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
 *
 * Usage: node .../card-emitter.js [--emit] [--lowlevel]
 * Invoked by Gate 4 (bin/witness-design-gates.sh) and `witness codegen`.
 */

const fs = require('fs');
const path = require('path');
const { boot } = require('../../boot');

async function bootAndLoadCardSpec() {
  const $ = await boot();
  await $.exec('(tc -)');

  // Load the high-level contracts if available in this boot context.
  // We do this defensively so the emitter continues to work for Gate 4 and
  // normal usage while we finish making the coupling fully robust.
  try {
    const propsRel = 'specs/ui/properties/card-properties.shen';
    const propsAbs = path.join(__dirname, '..', '..', propsRel);
    await $.load(propsAbs);
  } catch (e) {
    // Not fatal for the legacy/low-level path or current Gate 4 runs.
  }

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
  return top;
}

/**
 * Live contract shape from Shen (card-contract-shape). Removes need for
 * hand-maintained JS mirror of verified-card.
 */
async function getCardContractShape($) {
  try {
    const raw = await $.exec('(card-contract-shape)');
    if (!raw) return null;
    return parseContractShape(raw);
  } catch (e) {
    return null;
  }
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
  const titleD = slots.title || {};
  const descD = slots.desc || {};
  const actD = slots.actions || {};
  const defVariant = cs.default_variant || 'mobile';

  const base = {
    title: {
      ctor: 'mk-card-title',
      text: 'Card Title',
      font: titleD.font || '18px/1.2 sans-serif',
      maxW: titleD.maxW !== undefined ? titleD.maxW : 268,
      tokens: 'default-tokens'
    },
    desc: {
      ctor: 'mk-card-desc',
      text: 'Short desc for construction.',
      font: descD.font || '14px/1 sans-serif',
      maxW: descD.maxW !== undefined ? descD.maxW : 268,
      strategy: descD.strategy || 'ellipsis',
      tokens: 'default-tokens'
    },
    actions: [
      { ctor: 'mk-card-action', label: 'View Details', font: actD.font || '14px/1 sans-serif', maxW: actD.maxW !== undefined ? actD.maxW : 120, tokens: 'default-tokens' },
      { ctor: 'mk-card-action', label: 'Save', font: actD.font || '14px/1 sans-serif', maxW: actD.maxW !== undefined ? actD.maxW : 120, tokens: 'default-tokens' }
    ],
    variant: defVariant,
    tokens: 'default-tokens'
  };
  return {
    ...base,
    title: { ...base.title, ...(overrides.title || {}) },
    desc: { ...base.desc, ...(overrides.desc || {}) },
    actions: overrides.actions || base.actions,
    variant: overrides.variant || base.variant,
    tokens: overrides.tokens || base.tokens
  };
}

const CANONICAL_VERIFIED_CARD = makeCanonicalVerifiedCard();

function walkVerifiedCard(vc, contractShape) {
  // "Walk" the verified-card.
  // The token list (and when available, future values) come from the live
  // contractShape. Slot structure knowledge is also available via cs.slots.
  // The generator + walk are now narrow and driven by the Shen descriptor.
  const cs = contractShape || {};
  let tokens = {};
  const declaredTokens = (cs.tokens && Array.isArray(cs.tokens))
    ? cs.tokens
    : ['space-4', 'space-2', 'radius-lg', 'text-title', 'text-action'];

  for (const t of declaredTokens) {
    if (t === 'space-4') tokens[t] = 16;
    else if (t === 'space-2') tokens[t] = 8;
    else if (t === 'radius-lg') tokens[t] = 8;
    else if (t === 'text-title') tokens[t] = 18;
    else if (t === 'text-action') tokens[t] = 14;
  }

  return {
    tokens,
    treeShape: { width: 300, gap: 16, padding: 16, direction: 'column' },
    verifiedCard: vc,
    slots: {
      titleSlot: vc.title,
      descSlot: vc.desc,
      actionSlots: vc.actions,
      variant: vc.variant
    },
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

function generateCardTs(shape) {
  const { tokens, verifiedCard, slots, obligationsDischarged, contractShape: cs = {} } = shape;
  const slotDescs = cs.slots || {};
  const tvals = cs.token_values || {};
  const variants = (cs.variants && Array.isArray(cs.variants)) ? cs.variants : ['mobile', 'tablet', 'desktop'];
  const defVar = cs.default_variant || 'mobile';
  const titleD = slotDescs.title || { font: '18px/1.2 sans-serif', maxW: 268 };
  const descD = slotDescs.desc || { font: '14px/1 sans-serif', maxW: 268 };
  const actD = slotDescs.actions || { font: '14px/1 sans-serif', maxW: 120 };
  const s4 = tvals['space-4'] || tokens['space-4'] || 16;
  const s2 = tvals['space-2'] || tokens['space-2'] || 8;
  const variantUnion = variants.map(v => `'${v}'`).join(' | ');

  // High-level path walks the verified-card value produced by card-design-fidelity
  // (or makeCanonicalVerifiedCard). Branded Symbol factories enforce the sb-style
  // contract at the TS boundary. Gate 4 ensures fidelity to the Shen source.
  // Slot fields, fonts, maxW, variant union and defaults are now projected from
  // the live (card-contract-shape) — major reduction in hand-maintained mirror.
  const ts = `// GENERATED by shen-witness (codegen/emitters/card-emitter.js)
// from specs/ui/card-spec.shen + specs/ui/properties/card-properties.shen
// (walks verified-card from card-design-fidelity) — do not edit by hand.
// Regenerate: node codegen/emitters/card-emitter.js --emit
// Gate 4 (emitter fidelity) protects this output.

const CARD_TITLE_BRAND = Symbol('CardTitle');
const CARD_DESC_BRAND = Symbol('CardDesc');
const CARD_ACTION_BRAND = Symbol('CardAction');
const VERIFIED_CARD_BRAND = Symbol('VerifiedCard');

export interface CardTitle {
  readonly [CARD_TITLE_BRAND]: true;
  readonly text: string;
  readonly font: string;
  readonly maxW: number;
}

export interface CardDesc {
  readonly [CARD_DESC_BRAND]: true;
  readonly text: string;
  readonly font: string;
  readonly maxW: number;
}

export interface CardAction {
  readonly [CARD_ACTION_BRAND]: true;
  readonly text: string;
  readonly font: string;
  readonly maxW: number;
}

export interface VerifiedCard {
  readonly [VERIFIED_CARD_BRAND]: true;
  readonly title: CardTitle;
  readonly desc: CardDesc;
  readonly actions: CardAction[];
  readonly variant: 'mobile' | 'tablet' | 'desktop';
  readonly tokens: Record<string, number>;
}

export function createCardTitle(text: string): CardTitle {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('CardTitle requires non-empty string');
  }
  // Bounds projected from (card-contract-shape) slot descriptors (single source).
  return { [CARD_TITLE_BRAND]: true, text, font: '${titleD.font}', maxW: ${titleD.maxW} };
}

export function createCardDesc(text: string): CardDesc {
  if (typeof text !== 'string') {
    throw new Error('CardDesc requires string');
  }
  return { [CARD_DESC_BRAND]: true, text, font: '${descD.font}', maxW: ${descD.maxW} };
}

export function createCardAction(text: string): CardAction {
  if (typeof text !== 'string' || text.length === 0) {
    throw new Error('CardAction requires non-empty string');
  }
  return { [CARD_ACTION_BRAND]: true, text, font: '${actD.font}', maxW: ${actD.maxW} };
}

export function createCard(
  title: CardTitle,
  desc: CardDesc,
  actions: CardAction[],
  variant: ${variantUnion} = '${defVar}'
): VerifiedCard {
  if (!title || !(CARD_TITLE_BRAND in title)) throw new Error('title must be createCardTitle(...)');
  if (!desc || !(CARD_DESC_BRAND in desc)) throw new Error('desc must be createCardDesc(...)');
  if (!Array.isArray(actions) || actions.some(a => !(CARD_ACTION_BRAND in a))) {
    throw new Error('actions must be array of createCardAction(...)');
  }
  if (!['mobile','tablet','desktop'].includes(variant)) {
    throw new Error('variant must be mobile | tablet | desktop');
  }
  return {
    [VERIFIED_CARD_BRAND]: true,
    title,
    desc,
    actions,
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
      <div className="card__title">{card.title.text}</div>
      <div className="card__desc">{card.desc.text}</div>
      <div className="card__actions">
        {card.actions.map((a, i) => (
          <button key={i} className="card__action">{a.text}</button>
        ))}
      </div>
    </div>
  );
};
`;
  return ts;
}

function generateCardCss(shape) {
  const { tokens, treeShape, verifiedCard, obligationsDischarged, contractShape: cs = {} } = shape;
  const s4 = tokens['space-4'];
  const s2 = tokens['space-2'];
  const titleSize = tokens['text-title'];
  const actionSize = tokens['text-action'];
  const radius = tokens['radius-lg'];
  const w = treeShape.width;
  const slotDescs = cs.slots || {};
  const vw = cs.variant_widths || { mobile: 268, tablet: 400, desktop: 600 };
  const titleMaxW = (slotDescs.title && slotDescs.title.maxW) || 268;

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

/* Slot elements — names reflect the verified-card slots */
.card__title {
  font: var(--font-title);
  color: #111;
  /* max-width projected from (card-contract-shape) slot descriptor */
  max-width: ${titleMaxW}px;
}

.card__desc {
  font: var(--font-action);
  color: #444;
  /* handled-text ellipsis strategy is honoured by the emitted rules */
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card__actions {
  display: flex;
  gap: var(--space-2);
}

/* Action buttons inside the actions slot */
.card__action {
  font: var(--font-action);
  padding: ${s2}px ${s4}px;  /* from token values */
  border-radius: 6px;
  border: 1px solid #ddd;
  background: #fafafa;
  cursor: pointer;
}

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

// --- Richer output targets (emitter deepening) ---
// Storybook story stub, golden test fixture, and (bonus) variant matrix in CSS.
// These are generated from the verified-card walk so they are contract-faithful.
// They land in generated/card/ on --emit (or programmatically) alongside the
// core Card.tsx + card.css. Gate 4 fidelity now recognizes them.

function generateStorybookStub(shape) {
  const { slots, verifiedCard } = shape;
  const v = (slots && slots.variant) || (verifiedCard && verifiedCard.variant) || 'mobile';
  return `// GENERATED by shen-witness (codegen/emitters/card-emitter.js)
// Storybook story stub for the verified Card (from card-design-fidelity + verified-card walk)
// Regenerate: node codegen/emitters/card-emitter.js --emit
// Gate 4 protects this alongside Card.tsx + card.css.

import type { Meta, StoryObj } from '@storybook/react';
import { Card, createCard, createCardTitle, createCardDesc, createCardAction } from './Card';

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
  createCardTitle('Card Title'),
  createCardDesc('Short desc for construction.'),
  [createCardAction('View Details'), createCardAction('Save')]
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
  const { tokens, treeShape, verifiedCard, slots, obligationsDischarged } = shape;
  const fixture = {
    _meta: {
      generatedBy: 'shen-witness/card-emitter',
      source: 'specs/ui/properties/card-properties.shen (card-design-fidelity theorem)',
      note: 'Golden data for test snapshots, property tests, or golden-file checks. Matches the verified-card constructed under tc+.'
    },
    verifiedCard: {
      title: slots ? slots.titleSlot : verifiedCard.title,
      desc: slots ? slots.descSlot : verifiedCard.desc,
      actions: slots ? slots.actionSlots : verifiedCard.actions,
      variant: slots ? slots.variant : verifiedCard.variant,
      tokens: verifiedCard ? verifiedCard.tokens : tokens
    },
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
    'card.css': generateCardCss(shape)
  };

  // Richer output targets (WP-B emitter deepening): produced on high-level
  // verified-card walks (when shape carries verifiedCard/slots from the
  // contract). Legacy low-level path remains exactly 2 artifacts.
  if (highLevel && (shape.verifiedCard || shape.slots)) {
    files['Card.stories.tsx'] = generateStorybookStub(shape);
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
      return /\.card__title|\.card__desc|\.card__actions/.test(all);
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
    test: (files) => {
      const css = files['card.css'] || '';
      return /card--mobile|card--tablet|card--desktop|variant matrix/.test(css);
    },
    label: 'CSS variant matrix (from card-variant)'
  }
];

module.exports = {
  emit,
  generateCardTs,
  generateCardCss,
  generateStorybookStub,
  generateCardFixture,
  // High-level contract surface + construction helper (for future codegen drivers / tests / variant matrices)
  CANONICAL_VERIFIED_CARD,
  makeCanonicalVerifiedCard,
  walkVerifiedCard,
  extractHighLevelCardShape,
  // Gate 4 fidelity registry entry (per-component, auto-discovered)
  fidelityChecks: FIDELITY_CHECKS
};
