// Phase 4: proven-text rejects dynamic strings at load time.
//
// The rule: proven-text's first argument must be a literal string. Any
// other form — a variable, a function call like (js.get Props "x"), a
// let-bound name — is a compile-time error, not a runtime one. Dynamic
// text belongs in handled-text (CSS truncation) or behind a prop-spec
// with (max-width Font W) that proves the bound at the component
// boundary.
//
// These tests load fixture .shen files through the real boot, which
// means trust.shen has already registered its macro — so a bad
// proven-text fails at $.load time, before render is ever called.

const { boot } = require('../boot');
const fs = require('fs');
const path = require('path');
const os = require('os');

async function loadShen($, code) {
  const tmp = path.join(os.tmpdir(), `witness-trust-${Date.now()}-${Math.random()}.shen`);
  fs.writeFileSync(tmp, code);
  try {
    await $.load(tmp);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
  }
}

async function main() {
  console.log('\n=== trust.test.js — proven-text literal gate ===\n');
  const $ = await boot();
  // User files in the real Astro path load under (tc -) — they don't
  // carry inline type signatures on every helper. Match that here so we
  // isolate the Phase-4 macro's behavior from typecheck noise.
  await $.exec('(tc -)');

  let passed = 0, failed = 0;
  const check = (name, cond, detail) => {
    if (cond) { console.log(`  ✓ ${name}`); passed++; }
    else { console.log(`  ✗ ${name}: ${detail}`); failed++; }
  };

  // Users build safe-text via (proven-text ...) function-call form so
  // trust.shen's macro can gate the first argument at read time. The
  // return value is the same tagged list layout.shen matches on, so
  // wrapping it in [text-node ...] is idiomatic.

  // 1. Literal strings continue to compile.
  const good = await loadShen($, `
(assert-fits "Submit" (mk-font "sans-serif" 14) 96)
(define literal-label
  -> [text-node (proven-text "Submit" (mk-font "sans-serif" 14) 96)])
`);
  check('literal proven-text compiles', good.ok, good.error || '');

  // 2. js.get is the canonical Phase 4 bad case — must fail at load.
  const jsget = await loadShen($, `
(define render
  Props -> [text-node (proven-text (js.get Props "title") (mk-font "sans-serif" 14) 160)])
`);
  check('proven-text on (js.get ...) rejected', !jsget.ok,
    `expected failure, but loaded OK`);
  check('rejection message names proven-text',
    jsget.error && /proven-text/.test(jsget.error), jsget.error);
  check('rejection message points at the offending expression',
    jsget.error && /js\.get/.test(jsget.error), jsget.error);

  // 3. Variable (e.g. a function parameter) also rejected — the macro
  // can't see lexical scope and won't guess which symbols are safe.
  const variable = await loadShen($, `
(define nav-link
  Label MaxW ->
    [text-node (proven-text Label (mk-font "sans-serif" 14) MaxW)])
`);
  check('proven-text on bare variable rejected', !variable.ok,
    `expected failure, but loaded OK`);

  // 4. let-bound variable also rejected — even if bound to a literal,
  // the macro sees a symbol, not a literal.
  const letbound = await loadShen($, `
(define render
  _ -> (let L "hello"
         [text-node (proven-text L (mk-font "sans-serif" 14) 96)]))
`);
  check('proven-text on let-bound symbol rejected', !letbound.ok,
    `expected failure, but loaded OK`);

  // 5. handled-text remains the escape hatch for dynamic values — no
  // proof, CSS truncates on overflow.
  const handled = await loadShen($, `
(define render
  Props -> [text-node [handled-text (js.get Props "title") (mk-font "sans-serif" 12) 200 ellipsis]])
`);
  check('handled-text on dynamic values still compiles', handled.ok, handled.error || '');

  // 6. A literal inside a larger form still compiles.
  const inline = await loadShen($, `
(assert-fits "writing" (mk-font "sans-serif" 13) 60)
(define desk-nav
  -> [frame (mk-props9 400 0 "row" 16 0 "flex-end" "center" 0 0)
       [[text-node (proven-text "writing" (mk-font "sans-serif" 13) 60)]]])
`);
  check('literal proven-text inside nested form compiles', inline.ok, inline.error || '');

  // 7. Data-list form [proven-text X ...] loads without the macro firing
  // (macros don't fire on quoted lists), but it is dead code under
  // Phase 4: the framework pattern-matches on [proven-cell ...] (the
  // internal tag produced by the proven-text function), not on
  // [proven-text ...]. Any author who reaches for this form ends up
  // with a render that can't match any to-textura rule. We keep this
  // case here to document the shape, not to bless it.
  const dataform = await loadShen($, `
(define render
  Props -> [text-node [proven-text (js.get Props "title") (mk-font "sans-serif" 14) 160]])
`);
  check('data-list form loads (but is dead code — no pattern matches it)',
    dataform.ok, dataform.error || '');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
  console.log('\n=== trust tests OK ===');
}

main().catch(e => { console.error(e); process.exit(1); });
