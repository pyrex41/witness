#!/usr/bin/env node
/**
 * cli/freerange-audit.js
 *
 * Track C: the `fr --audit` -> Shen bounds bridge (a deliberate spike).
 *
 * Shells out to ./node_modules/.bin/fr --audit <file> (one file per invocation --
 * the `fr --audit` binary itself only accepts zero-or-one path argument; see
 * "MULTIPLE PATHS" below), parses freerange's human-readable audit report into a
 * structured JSON shape, and optionally emits a GENERATED Shen facts file wiring
 * freerange's inferred numeric ranges into the `(bounded Lo Hi)` proof rule
 * added in shen/proofs.shen.
 *
 * Usage:
 *   node cli/freerange-audit.js <path...> [--json] [--emit-shen <outfile>]
 *
 * Exit code: 0 on normal operation (including "freerange found nothing" and
 * "freerange's output didn't parse the way we expected"). Non-zero ONLY for
 * genuine CLI usage errors (no paths given) or an I/O failure writing
 * --emit-shen's output file. See "DEFENSIVE BY CONSTRUCTION" below.
 *
 * ---------------------------------------------------------------------------
 * DEFENSIVE BY CONSTRUCTION
 * ---------------------------------------------------------------------------
 * freerange v0.0.2 has no JSON output and no programmatic API (see the plan
 * doc, "Honest limitation to keep in view"). This file parses its prose
 * report with regexes derived from reading the actual formatter source in
 * node_modules/.bin/fr (src/report/*.ts, bundled) and from running `fr
 * --audit` against real fixtures. Every regex is applied defensively:
 *   - A line that doesn't match any known shape is collected into an
 *     `unparsed[]` bucket (per-file and top-level) -- it is NEVER thrown on.
 *   - A `requires:`/`ensures:` line that matches the outer "label: text
 *     (source at site)" shape but whose inner English doesn't match any of
 *     the known numeric-range/condition grammars still keeps its raw text
 *     (parsed: false) and is ALSO mirrored into unparsed[] for visibility.
 *   - If `fr` itself is missing, or exits non-zero for a given path (file
 *     not found, not part of the tsconfig project, etc.), that path gets an
 *     entry in `errors[]` and the run continues with the remaining paths.
 * A future freerange release that changes its output format therefore
 * degrades gracefully to "no facts learned" (empty functions/bounds, full
 * unparsed[] dump) rather than crashing the build.
 *
 * ---------------------------------------------------------------------------
 * MULTIPLE PATHS
 * ---------------------------------------------------------------------------
 * Empirically, `fr --audit <a> <b>` errors ("Usage: fr --audit [file]") --
 * the underlying binary accepts at most one path. Our CLI accepts
 * `<path...>` per the agreed interface, so we invoke `fr --audit <path>`
 * once per path (cwd = repo root, which is where fr requires tsconfig.json
 * to live) and merge the per-path reports into one JSON document.
 *
 * ---------------------------------------------------------------------------
 * HONEST LIMITATION
 * ---------------------------------------------------------------------------
 * freerange is NUMBERS ONLY. It has nothing to say about strings. The
 * bounds this file extracts and emits are numeric widths/counts (layout
 * arithmetic), never bounded-string / max-chars. See shen/proofs.shen for
 * the corresponding note next to the new `(bounded Lo Hi)` rule.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const FR_BIN = path.join(REPO_ROOT, 'node_modules', '.bin', 'fr');

// ===========================================================================
// === Parsing: `fr --audit` report text -> structured facts             ===
// ===========================================================================

// Strip ANSI color codes defensively. Non-tty stdout is expected to already
// be plain, but this costs nothing and protects against a future default
// flip.
function stripAnsi(s) {
  return s.replace(/\x1B\[[0-9;]*m/g, '');
}

const KNOWN_DETAIL_LABELS = [
  'requires',
  'ensures',
  'assumes',
  'proves',
  'partially supported',
  'on analyzed paths',
  'unsupported',
  'skipped',
];

// Map a detail label to the bucket name on the function record.
const LABEL_TO_BUCKET = {
  requires: 'requires',
  ensures: 'ensures',
  assumes: 'assumes',
  proves: 'proves',
  'partially supported': 'partiallySupported',
  'on analyzed paths': 'onAnalyzedPaths',
  unsupported: 'unsupported',
  skipped: 'skipped',
};

const DETAIL_LINE_RE = new RegExp(
  '^  (' + KNOWN_DETAIL_LABELS.map((l) => l.replace(/ /g, '\\ ')).join('|') + '): (.*)$'
);

// `# file (coverage fragment)` header.
const FILE_HEADER_RE = /^# (.+) \((.+)\)$/;

// Optional trailing aggregate line, only present when `fr --audit` covers
// more than one file (e.g. invoked with no path, driven by tsconfig include).
const GLOBAL_COVERAGE_RE =
  /^coverage: (\d+)\/(\d+) named top-level function declarations fully analyzed; (\d+) partially supported; (\d+) unsupported\.$/;

// `file(line,col): suggestion [id]: text` inside "## Refactoring suggestions".
const SUGGESTION_RE = /^(.+)\((\d+),(\d+)\): suggestion \[([a-z0-9-]+)\]: (.*)$/;

// Per-file header coverage fragment, e.g.
//   "1/2 functions fully analyzed; 1 partially supported"
//   "0/1 functions fully analyzed; 1 unsupported"
//   "3/5 functions fully analyzed; 1 partially supported; 1 unsupported"
//   "3/3 functions fully analyzed"
//   "0/4 functions fully analyzed; 4 unsupported; 5 module statements skipped"
function parseFileCoverageFragment(fragment) {
  const parts = fragment.split('; ');
  const head = parts[0].match(/^(\d+)\/(\d+) functions fully analyzed$/);
  if (!head) {
    return {
      raw: fragment,
      parsed: false,
      analyzed: null,
      total: null,
      partial: 0,
      unsupported: 0,
      moduleStatementsSkipped: 0,
      unrecognizedClauses: [],
    };
  }
  const result = {
    raw: fragment,
    parsed: true,
    analyzed: Number(head[1]),
    total: Number(head[2]),
    partial: 0,
    unsupported: 0,
    moduleStatementsSkipped: 0,
    unrecognizedClauses: [],
  };
  for (const part of parts.slice(1)) {
    let m;
    if ((m = part.match(/^(\d+) (partially supported|unsupported)$/))) {
      if (m[2] === 'partially supported') result.partial = Number(m[1]);
      else result.unsupported = Number(m[1]);
    } else if ((m = part.match(/^(\d+) module statements? skipped$/))) {
      result.moduleStatementsSkipped = Number(m[1]);
    } else {
      // Unrecognized clause: the mandatory "N/M functions fully analyzed"
      // head still parsed fine, so analyzed/total/etc. above remain
      // trustworthy -- only flag the fragment as not-fully-understood and
      // keep the raw clause text for the caller to surface via unparsed[].
      result.parsed = false;
      result.unrecognizedClauses.push(part);
    }
  }
  return result;
}

function parseGlobalCoverageLine(line) {
  const m = line.match(GLOBAL_COVERAGE_RE);
  if (!m) return null;
  return {
    raw: line,
    analyzed: Number(m[1]),
    total: Number(m[2]),
    partial: Number(m[3]),
    unsupported: Number(m[4]),
  };
}

// --- Numeric literal parsing (handles the +-Infinity spellings freerange uses) ---
function parseFrNumber(str) {
  if (str === 'Infinity') return Infinity;
  if (str === '-Infinity') return -Infinity;
  const n = Number(str);
  return Number.isNaN(n) ? null : n;
}

// JSON.stringify(Infinity) === "null" -- silently wrong for our purposes.
// Represent non-finite bounds as the strings "Infinity"/"-Infinity" in JSON
// output and as-is (still a JS number) in-memory.
function jsonNumber(n) {
  if (n === null) return null;
  if (n === Infinity) return 'Infinity';
  if (n === -Infinity) return '-Infinity';
  return n;
}

// --- `ensures`/`on analyzed paths` numeric-range grammar ---
// Derived from numberSummary() in the bundled fr source:
//   subject = "{path} is a {domain}{kind}number"
//   domain  in {"possibly NaN ", "finite ", "possibly non-finite "}
//   kind    in {"integer ", ""}
// followed by one of (mutually exclusive, in the priority order fr itself uses):
//   (nothing)                                     -- both bounds unbounded
//   " at least X" | " more than X"                -- lower bound only
//   " at most Y"  | " less than Y"                -- upper bound only
//   " (at least|more than) X and (at most|less than) Y"  -- both bounds, "strict" wording
//   " from X through Y"                           -- both bounds, plain wording (incl. point intervals)
// optionally followed by a blame suffix:
//   " (can overflow at SITE)" | " (NaN possible from the operation at SITE)"
const RE_BLAME_OVERFLOW = /^(.*) \(can overflow at (.+)\)$/;
const RE_BLAME_NAN = /^(.*) \(NaN possible from the operation at (.+)\)$/;

const DOMAIN_ALT = '(possibly NaN|finite|possibly non-finite)';
const RE_NUM_COMBO = new RegExp(
  `^(.+) is a ${DOMAIN_ALT} (integer )?number (at least|more than) (\\S+) and (at most|less than) (\\S+)$`
);
const RE_NUM_FROM_THRU = new RegExp(
  `^(.+) is a ${DOMAIN_ALT} (integer )?number from (\\S+) through (\\S+)$`
);
const RE_NUM_LOWER_ONLY = new RegExp(
  `^(.+) is a ${DOMAIN_ALT} (integer )?number (at least|more than) (\\S+)$`
);
const RE_NUM_UPPER_ONLY = new RegExp(
  `^(.+) is a ${DOMAIN_ALT} (integer )?number (at most|less than) (\\S+)$`
);
// "<path> is boolean" / "is true" / "is false" / "is a string" — understood,
// carries no interval.
const RE_NON_NUMERIC = /^(.+) is (?:a |an )?(boolean|true|false|string|null|undefined)$/;
const RE_NUM_UNBOUNDED = new RegExp(`^(.+) is a ${DOMAIN_ALT} (integer )?number$`);

function domainFlags(domainWord) {
  return {
    finite: domainWord === 'finite',
    mayBeNaN: domainWord === 'possibly NaN',
    // true whenever the value could be non-finite (Infinity/-Infinity), i.e.
    // NOT the plain "finite" domain word (possibly-NaN values also aren't
    // guaranteed finite in fr's own domain lattice).
    possiblyNonFinite: domainWord !== 'finite',
  };
}

// Parses one `ensures:`/`on analyzed paths:` text body (label already
// stripped) into a structured numeric-range fact, or returns
// { parsed: false, raw } if the English doesn't match any known shape.
function parseNumericProseText(raw) {
  let blame = null;
  let body = raw;
  const overflowM = raw.match(RE_BLAME_OVERFLOW);
  const nanM = raw.match(RE_BLAME_NAN);
  if (overflowM) {
    body = overflowM[1];
    blame = { kind: 'overflow', site: overflowM[2] };
  } else if (nanM) {
    body = nanM[1];
    blame = { kind: 'nan', site: nanM[2] };
  }

  let m;

  // NON-NUMERIC ensures. freerange emits these routinely for boolean-returning
  // functions ("return is boolean", "return is true"), and they were falling
  // into unparsed[] — which meant the drift alarm was permanently ringing on
  // healthy output and therefore never actionable. They are recognised and
  // marked non-numeric: understood, but never a source of interval facts.
  if ((m = body.match(RE_NON_NUMERIC))) {
    return {
      parsed: true,
      numeric: false,
      path: m[1],
      kind: m[2],
      lower: null,
      upper: null,
      blame,
    };
  }

  if ((m = body.match(RE_NUM_COMBO))) {
    const lowerIncl = m[4] === 'at least';
    const upperIncl = m[6] === 'at most';
    return {
      parsed: true,
      raw,
      path: m[1],
      ...domainFlags(m[2]),
      integer: Boolean(m[3]),
      lower: parseFrNumber(m[5]),
      lowerInclusive: lowerIncl,
      upper: parseFrNumber(m[7]),
      upperInclusive: upperIncl,
      blame,
    };
  }
  if ((m = body.match(RE_NUM_FROM_THRU))) {
    return {
      parsed: true,
      raw,
      path: m[1],
      ...domainFlags(m[2]),
      integer: Boolean(m[3]),
      lower: parseFrNumber(m[4]),
      lowerInclusive: true,
      upper: parseFrNumber(m[5]),
      upperInclusive: true,
      blame,
    };
  }
  if ((m = body.match(RE_NUM_LOWER_ONLY))) {
    return {
      parsed: true,
      raw,
      path: m[1],
      ...domainFlags(m[2]),
      integer: Boolean(m[3]),
      lower: parseFrNumber(m[5]),
      lowerInclusive: m[4] === 'at least',
      upper: null,
      upperInclusive: null,
      blame,
    };
  }
  if ((m = body.match(RE_NUM_UPPER_ONLY))) {
    return {
      parsed: true,
      raw,
      path: m[1],
      ...domainFlags(m[2]),
      integer: Boolean(m[3]),
      lower: null,
      lowerInclusive: null,
      upper: parseFrNumber(m[5]),
      upperInclusive: m[4] === 'at most',
      blame,
    };
  }
  if ((m = body.match(RE_NUM_UNBOUNDED))) {
    return {
      parsed: true,
      raw,
      path: m[1],
      ...domainFlags(m[2]),
      integer: Boolean(m[3]),
      lower: null,
      lowerInclusive: null,
      upper: null,
      upperInclusive: null,
      blame,
    };
  }
  return { parsed: false, raw };
}

// --- `requires:` condition grammar ---
// Derived from conditionWords()/formatPrecondition() in the bundled fr source:
//   "<condition> (<source> at <site>)"
// where <source> is "declared" (explicit console.assert), "input" (implicit,
// inferred from parameter usage), or an operation name like "division" /
// "element read".
const RE_REQUIRES_WRAPPER = /^(.+) \(([a-zA-Z ]+) at ([^)]+)\)$/;

const RE_COND_IS_FINITE = /^Number\.isFinite\((.+)\)$/;
const RE_COND_IS_INTEGER = /^Number\.isInteger\((.+)\)$/;
const RE_COND_IS_NAN = /^Number\.isNaN\((.+)\)$/;
const RE_COND_COMPARISON = /^(.+?) (<=|>=|<|>|===|!==) (.+)$/;
const RE_COND_NONZERO = /^(.+) is nonzero$/;
const RE_COND_NOT_EQUAL = /^(.+) is not (.+)$/;
const RE_COND_IN_BOUNDS = /^(.+) is a valid (.+) index$/;

function parseCondition(conditionText) {
  let m;
  if ((m = conditionText.match(RE_COND_IS_FINITE))) {
    return { kind: 'finite', expr: m[1] };
  }
  if ((m = conditionText.match(RE_COND_IS_INTEGER))) {
    return { kind: 'integer', expr: m[1] };
  }
  if ((m = conditionText.match(RE_COND_IS_NAN))) {
    return { kind: 'isNaN', expr: m[1] };
  }
  if ((m = conditionText.match(RE_COND_NONZERO))) {
    return { kind: 'nonzero', expr: m[1] };
  }
  if ((m = conditionText.match(RE_COND_IN_BOUNDS))) {
    return { kind: 'inBounds', indexExpr: m[1], sequenceExpr: m[2] };
  }
  if ((m = conditionText.match(RE_COND_COMPARISON))) {
    const [, expr, op, valueText] = m;
    const value = parseFrNumber(valueText);
    const cond = { kind: 'comparison', expr, op, valueText, value };
    if (value !== null) {
      if (op === '>=') Object.assign(cond, { boundKind: 'lower', boundInclusive: true, bound: value });
      else if (op === '>') Object.assign(cond, { boundKind: 'lower', boundInclusive: false, bound: value });
      else if (op === '<=') Object.assign(cond, { boundKind: 'upper', boundInclusive: true, bound: value });
      else if (op === '<') Object.assign(cond, { boundKind: 'upper', boundInclusive: false, bound: value });
      else if (op === '===') Object.assign(cond, { boundKind: 'exact', bound: value });
    }
    return cond;
  }
  // "is not" must be tried after comparison/nonzero (both are more specific
  // textual shapes that could theoretically overlap in weird ways); kept
  // last defensively.
  if ((m = conditionText.match(RE_COND_NOT_EQUAL))) {
    return { kind: 'notEqual', expr: m[1], valueText: m[2] };
  }
  return { kind: 'unknown', text: conditionText };
}

function parseRequiresText(raw) {
  const m = raw.match(RE_REQUIRES_WRAPPER);
  if (!m) {
    return { parsed: false, raw, source: null, site: null, condition: null };
  }
  const [, conditionText, source, site] = m;
  const condition = parseCondition(conditionText);
  return {
    parsed: condition.kind !== 'unknown',
    raw,
    conditionText,
    source,
    site,
    condition,
  };
}

// ===========================================================================
// === Line-by-line state machine over one `fr --audit` report            ===
// ===========================================================================

function makeFunctionRecord(name) {
  return {
    name,
    requires: [],
    ensures: [],
    assumes: [],
    proves: [],
    partiallySupported: [],
    unsupported: [],
    onAnalyzedPaths: [],
    skipped: [],
    raw: [],
  };
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

// fr's audit report groups skipped/unsupported top-level module statements
// (const declarations that aren't simple numeric literals, side-effecting
// statements, etc.) under this fixed pseudo-function heading rather than a
// real identifier (confirmed against the literal `moduleInitializerName`
// constant in the bundled fr source). Recognized here so its `skipped:` /
// `unsupported:` lines land in a function-shaped record instead of the
// orphan-detail unparsed bucket.
const MODULE_INIT_PSEUDO_NAME = 'module initialization';

function parseAuditText(text) {
  const cleaned = stripAnsi(text).replace(/\r\n/g, '\n');
  const lines = cleaned.split('\n');

  const result = {
    files: [],
    refactoringSuggestions: [],
    globalCoverage: null,
    unparsed: [], // lines outside any file block, or in an unrecognized section
  };

  let currentFile = null; // { file, coverage, functions: [], unparsed: [] }
  let currentSection = null; // 'contracts' | 'suggestions' | 'unknown' | null
  let currentFn = null;

  function pushUnparsed(line, context) {
    const entry = { line, context };
    if (currentFile) currentFile.unparsed.push(entry);
    else result.unparsed.push(entry);
  }

  for (const rawLine of lines) {
    const line = rawLine; // preserve internal whitespace; only trim for blank-check
    if (line.trim() === '') continue;

    let m;
    if ((m = line.match(FILE_HEADER_RE))) {
      const coverage = parseFileCoverageFragment(m[2]);
      currentFile = {
        file: m[1],
        coverage,
        functions: [],
        unparsed: [],
      };
      result.files.push(currentFile);
      for (const clause of coverage.unrecognizedClauses) {
        currentFile.unparsed.push({ line: `(header coverage clause) ${clause}`, context: 'file-header:coverage' });
      }
      currentSection = null;
      currentFn = null;
      continue;
    }

    if (line.startsWith('## ')) {
      const heading = line.slice(3).trim();
      if (heading === 'Contracts') currentSection = 'contracts';
      else if (heading === 'Refactoring suggestions') currentSection = 'suggestions';
      else currentSection = 'unknown';
      currentFn = null;
      continue;
    }

    if ((m = line.match(GLOBAL_COVERAGE_RE))) {
      result.globalCoverage = parseGlobalCoverageLine(line);
      continue;
    }

    if (currentSection === 'suggestions') {
      if ((m = line.match(SUGGESTION_RE))) {
        result.refactoringSuggestions.push({
          file: m[1],
          line: Number(m[2]),
          col: Number(m[3]),
          id: m[4],
          text: m[5],
        });
      } else {
        pushUnparsed(line, 'suggestions');
      }
      continue;
    }

    if (currentSection === 'contracts') {
      if ((m = line.match(DETAIL_LINE_RE))) {
        const label = m[1];
        const text = m[2];
        if (!currentFn) {
          // A detail line with no preceding function name -- format drift.
          // Never fatal: collect and move on.
          pushUnparsed(line, 'contracts:orphan-detail');
          continue;
        }
        const bucket = LABEL_TO_BUCKET[label];
        currentFn.raw.push(line.slice(2)); // detail text without the 2-space indent

        if (label === 'requires') {
          const parsedReq = parseRequiresText(text);
          currentFn.requires.push(parsedReq);
          if (!parsedReq.parsed) pushUnparsed(line, `contracts:${currentFn.name}:requires`);
        } else if (label === 'ensures') {
          const parsedEns = parseNumericProseText(text);
          currentFn.ensures.push(parsedEns);
          if (!parsedEns.parsed) pushUnparsed(line, `contracts:${currentFn.name}:ensures`);
        } else if (label === 'on analyzed paths') {
          // Same numeric-range grammar as `ensures`, but only guaranteed on
          // the subset of paths freerange actually finished analyzing (e.g.
          // a recursive function's base case). Kept in its own bucket and
          // NOT treated as a full-function `ensures` fact -- see
          // buildBoundsFacts()'s "fully analyzed only" gate below.
          currentFn.onAnalyzedPaths.push(parseNumericProseText(text));
        } else {
          // assumes / proves / partiallySupported / unsupported / skipped:
          // raw prose only (the task scope for numeric-range extraction is
          // explicitly requires/ensures).
          currentFn[bucket].push(text);
        }
        continue;
      }

      if (IDENTIFIER_RE.test(line) || line === MODULE_INIT_PSEUDO_NAME) {
        currentFn = makeFunctionRecord(line);
        if (currentFile) currentFile.functions.push(currentFn);
        else pushUnparsed(line, 'contracts:function-name-outside-file'); // should not happen
        continue;
      }

      pushUnparsed(line, 'contracts:unrecognized');
      continue;
    }

    // No section context (before "## Contracts", or an unrecognized "## ..."
    // section) -- collect defensively.
    pushUnparsed(line, currentSection ? `section:${currentSection}` : 'no-section');
  }

  return result;
}

// ===========================================================================
// === Running `fr --audit` (one path at a time; see MULTIPLE PATHS above) ===
// ===========================================================================

function runAuditForPath(rawPath) {
  const requestedPath = rawPath;
  const absPath = path.resolve(process.cwd(), rawPath);

  if (!fs.existsSync(FR_BIN)) {
    return {
      requestedPath,
      ok: false,
      error: `freerange binary not found at ${FR_BIN} (is @chenglou/freerange installed?)`,
      report: null,
    };
  }

  let proc;
  try {
    proc = spawnSync(FR_BIN, ['--audit', absPath], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    return {
      requestedPath,
      ok: false,
      error: `failed to spawn fr: ${e && e.message ? e.message : String(e)}`,
      report: null,
    };
  }

  if (proc.error) {
    return {
      requestedPath,
      ok: false,
      error: `failed to spawn fr: ${proc.error.message}`,
      report: null,
    };
  }

  if (proc.status !== 0) {
    // Per ground truth, `fr --audit` on a resolvable single file always
    // exits 0. A non-zero exit here means a usage-level problem (file not
    // found, file outside the tsconfig project, etc.) rather than audit
    // content to parse -- never fatal to the overall build.
    return {
      requestedPath,
      ok: false,
      error: (proc.stderr || proc.stdout || `fr exited ${proc.status}`).trim(),
      report: null,
    };
  }

  return {
    requestedPath,
    ok: true,
    error: null,
    report: parseAuditText(proc.stdout || ''),
  };
}

// ===========================================================================
// === Shen fact generation (specs/generated/numeric-bounds.shen)         ===
// ===========================================================================

// Any parsed bound with |value| beyond this is treated as "not a real
// design constraint" and excluded from emission (see the sentinel-drift
// comment in buildBoundsFacts). Generous for any plausible layout
// width/count, minuscule next to Number.MAX_VALUE (~1.8e308) or its
// half (~9e307), where fr's own "unbounded" sentinel and its arithmetic
// fallout live.
const PRACTICAL_BOUND_LIMIT = 1e12;

function camelToKebab(name) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();
}

// Renders a bound number for direct embedding in a Shen `(list Lo Hi)` form.
// Only called for finite bounds (see the "closed intervals only" gate in
// buildBoundsFacts) -- Infinity has no portable Shen numeric literal here,
// so functions with an open side are excluded from emission entirely
// (reported separately, not silently dropped).
function shenNumberLiteral(n) {
  if (!Number.isFinite(n)) {
    throw new Error(`shenNumberLiteral called with a non-finite value: ${n}`);
  }
  return String(n);
}

// Walks the parsed audit results and produces the list of emittable numeric
// bound facts, plus a record of what was fully analyzed but NOT emitted
// (and why) for transparency.
//
// Soundness gate: only functions freerange reports as fully, unconditionally
// analyzed (zero partiallySupported/unsupported/skipped entries) contribute
// facts. A function with any of those is, by freerange's own accounting,
// not something it has fully vouched for -- we don't want a Shen fact that
// looks like a hard guarantee but is actually a partial one.
//
// Range gate: only a genuinely closed interval (both lower and upper finite
// real numbers) becomes a `(bounded Lo Hi)` fact. A one-sided or fully open
// range cannot discharge a `fits?`-style "worst case <= MaxW" obligation
// (there is no worst case), so it is excluded from the emitted Shen and
// listed in `excluded` instead.
function buildBoundsFacts(parsedFiles) {
  const facts = [];
  const excluded = [];
  const usedNames = new Set();

  for (const pathResult of parsedFiles) {
    if (!pathResult.ok || !pathResult.report) continue;
    const globalCoverage = pathResult.report.globalCoverage;
    for (const fileBlock of pathResult.report.files) {
      for (const fn of fileBlock.functions) {
        // SOUNDNESS GATE 1 — "fully analyzed" must not be inferred from ABSENCE.
        //
        // This previously tested only that the partiallySupported / unsupported
        // / skipped buckets were empty. Those buckets fill only when a line
        // matches one of eight hardcoded labels, so if freerange renames a
        // label its lines land in unparsed[] and the buckets stay empty — and
        // the function is judged fully analyzed on the strength of output we
        // failed to understand. Format drift would MANUFACTURE confidence
        // instead of degrading to silence, the opposite of what this file's
        // header promises.
        //
        // The per-file coverage header states the same fact independently, so
        // require both to agree, and refuse to emit facts from a file whose
        // output we did not fully understand.
        const bucketsClean =
          fn.partiallySupported.length === 0 && fn.unsupported.length === 0 && fn.skipped.length === 0;
        const cov = fileBlock.coverage || {};
        const coverageAgrees =
          cov.parsed === true &&
          cov.partial === 0 &&
          cov.unsupported === 0 &&
          typeof cov.analyzed === 'number' &&
          typeof cov.total === 'number' &&
          cov.analyzed === cov.total;
        const fileFullyUnderstood = (fileBlock.unparsed || []).length === 0;
        // The trailing `coverage:` summary line is a THIRD independent
        // statement of the same fact. For a single-file report it describes
        // this file; when several files were audited it is a total, so it can
        // only be required to agree when it is unambiguous.
        const gc = globalCoverage || {};
        const singleFileReport = (parsedFiles.length === 1) &&
          (((parsedFiles[0].report || {}).files || []).length === 1);
        const gcUsable = typeof gc.analyzed === 'number' && typeof gc.total === 'number';
        const globalAgrees =
          !singleFileReport ||
          !gcUsable ||
          (gc.partial === 0 && gc.unsupported === 0 && gc.analyzed === gc.total);
        const fullyAnalyzed =
          bucketsClean && coverageAgrees && fileFullyUnderstood && globalAgrees;

        // Prefer the top-level scalar `return` ensures fact (our generated
        // layout functions all return a single number). Nested-path facts
        // (e.g. "return.foo is ...") are out of scope for this spike.
        // Must be the NUMERIC return fact. Non-numeric ensures now parse too
        // (see RE_NON_NUMERIC), and picking one here would report a boolean
        // function as an "open-or-unbounded-interval" exclusion rather than
        // what it is: a function with no interval to state.
        const returnEnsures = fn.ensures.find(
          (e) => e.parsed && e.path === 'return' && e.numeric !== false
        );

        const baseName = camelToKebab(fn.name);
        let shenName = `fr-bound-${baseName}`;
        if (usedNames.has(shenName)) {
          let i = 2;
          while (usedNames.has(`${shenName}-${i}`)) i++;
          shenName = `${shenName}-${i}`;
        }

        if (!fullyAnalyzed) {
          excluded.push({ function: fn.name, file: fileBlock.file, reason: 'not-fully-analyzed' });
          continue;
        }
        if (!returnEnsures) {
          excluded.push({ function: fn.name, file: fileBlock.file, reason: 'no-parsed-ensures-return-fact' });
          continue;
        }
        // SOUNDNESS GATE 2 — a possibly-NaN or possibly-non-finite return must
        // not become a closed-interval fact. domainFlags() already computes
        // these, and the generated file even writes companion finite?/integer?
        // flags, but the gate never consulted them: an ensures of
        // "return is a possibly NaN number from 100 through 200" passed every
        // check and emitted (bounded 100 200). NaN satisfies no interval, so
        // that fact is not merely imprecise, it is false.
        if (returnEnsures.mayBeNaN || returnEnsures.possiblyNonFinite) {
          excluded.push({
            function: fn.name,
            file: fileBlock.file,
            reason: returnEnsures.mayBeNaN ? 'return-may-be-nan' : 'return-may-be-non-finite',
          });
          continue;
        }
        if (
          returnEnsures.lower === null ||
          returnEnsures.upper === null ||
          !Number.isFinite(returnEnsures.lower) ||
          !Number.isFinite(returnEnsures.upper)
        ) {
          excluded.push({
            function: fn.name,
            file: fileBlock.file,
            reason: 'open-or-unbounded-interval',
            lower: jsonNumber(returnEnsures.lower),
            upper: jsonNumber(returnEnsures.upper),
          });
          continue;
        }
        // Sentinel guard: fr represents an UNCONSTRAINED side of a range
        // using +-Number.MAX_VALUE (see numberSummary() in the bundled fr
        // source), and ordinary finite arithmetic on that sentinel (e.g. a
        // plain `x / 2` with no declared bound on `x`) can land just off
        // it (e.g. +-8.988465674311579e+307 = MAX_VALUE / 2) -- still
        // `Number.isFinite`, but not a real design constraint, and its
        // scientific-notation text is not guaranteed to be valid Shen
        // numeric literal syntax. PRACTICAL_BOUND_LIMIT is comfortably
        // above any real layout width/count while staying far below where
        // this sentinel drift shows up.
        if (Math.abs(returnEnsures.lower) > PRACTICAL_BOUND_LIMIT || Math.abs(returnEnsures.upper) > PRACTICAL_BOUND_LIMIT) {
          excluded.push({
            function: fn.name,
            file: fileBlock.file,
            reason: 'bound-exceeds-practical-limit',
            lower: jsonNumber(returnEnsures.lower),
            upper: jsonNumber(returnEnsures.upper),
          });
          continue;
        }

        usedNames.add(shenName);
        facts.push({
          shenName,
          function: fn.name,
          file: fileBlock.file,
          lower: returnEnsures.lower,
          upper: returnEnsures.upper,
          integer: Boolean(returnEnsures.integer),
          finite: Boolean(returnEnsures.finite),
          sourceRaw: returnEnsures.raw,
        });
      }
    }
  }

  return { facts, excluded };
}

function renderShenFile(facts, excluded, sourcePaths, generatorInvocation) {
  const header = `\\\\ specs/generated/numeric-bounds.shen — GENERATED FILE, DO NOT EDIT BY HAND
\\\\
\\\\ Generator:  cli/freerange-audit.js
\\\\ Invocation: ${generatorInvocation}
\\\\ Source(s):  ${sourcePaths.length ? sourcePaths.join(', ') : '(none)'}
\\\\ Generated:  ${new Date().toISOString()}
\\\\
\\\\ Regenerate with:
\\\\   node cli/freerange-audit.js ${sourcePaths.join(' ')} --emit-shen specs/generated/numeric-bounds.shen
\\\\
\\\\ HONEST LIMITATION: freerange is NUMBERS ONLY. Every fact below bounds a
\\\\ numeric layout WIDTH or COUNT that freerange's static interval analysis
\\\\ inferred for a fully-analyzed, top-level function's return value. This
\\\\ file says nothing about STRINGS -- bounded-string / max-chars worst-case
\\\\ proofs are a separate, pre-existing rule (the single-argument
\\\\ \`S : (bounded N)\` sequent in shen/proofs.shen, over string-length) that
\\\\ this generator does not touch and freerange cannot analyze.
\\\\
\\\\ Soundness gates applied before a function's return value becomes a fact
\\\\ here (see cli/freerange-audit.js's buildBoundsFacts):
\\\\   1. freerange reported the function as FULLY analyzed (no
\\\\      partially-supported / unsupported / skipped findings for it).
\\\\   2. Its \`ensures\` fact for the (whole, top-level) return value parsed
\\\\      to a CLOSED interval -- both a finite lower and a finite upper
\\\\      bound. One-sided or fully open ranges are excluded (see below):
\\\\      there is no "worst case" to discharge a fits?-style obligation
\\\\      against.
\\\\
\\\\ Each fact is a pair: \`(define fr-bound-<fn> { --> (list number) } -> [Lo Hi])\`
\\\\ plus companion integer?/finite? flags, consumable by the \`(bounded Lo Hi)\`
\\\\ rule in shen/proofs.shen.
`;

  const factLines = facts.map((f) => {
    return `\\\\ ${f.function} (${f.file}) — from: ensures: ${f.sourceRaw}
(define ${f.shenName} { --> (list number) } -> [${shenNumberLiteral(f.lower)} ${shenNumberLiteral(f.upper)}])

(define ${f.shenName}-integer? { --> boolean } -> ${f.integer ? 'true' : 'false'})

(define ${f.shenName}-finite? { --> boolean } -> ${f.finite ? 'true' : 'false'})
`;
  });

  const excludedComment =
    excluded.length === 0
      ? ''
      : `\\\\ --- Not emitted (soundness gates above) ---\n` +
        excluded
          .map(
            (e) =>
              `\\\\   ${e.function} (${e.file}): ${e.reason}` +
              (e.reason === 'open-or-unbounded-interval' ? ` [${e.lower}, ${e.upper}]` : '')
          )
          .join('\n') +
        '\n';

  const body =
    facts.length === 0
      ? '\\\\ No facts learned this run (nothing passed both soundness gates above).\n'
      : factLines.join('\n');

  return header + '\n' + body + '\n' + excludedComment;
}

// ===========================================================================
// === CLI glue                                                            ===
// ===========================================================================

function printUsage() {
  console.error(`Usage: node cli/freerange-audit.js <path...> [--json] [--emit-shen <outfile>]

Runs ./node_modules/.bin/fr --audit against each path (one at a time --
the underlying binary takes at most one path per invocation) and parses
the result into structured facts.

  --json              Print the full parsed result as JSON to stdout.
  --emit-shen <file>  Write a GENERATED Shen facts file (specs/generated/...)
                      wiring fully-analyzed, closed-interval numeric bounds
                      into the (bounded Lo Hi) rule in shen/proofs.shen.

Exit code is 0 unless no paths were given or --emit-shen's write failed.
freerange output that doesn't parse never fails the build -- see the header
comment in this file.`);
}

function main() {
  const argv = process.argv.slice(2);
  const paths = [];
  let wantJson = false;
  let emitShenOut = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') {
      wantJson = true;
    } else if (a === '--emit-shen') {
      emitShenOut = argv[++i];
      if (!emitShenOut) {
        console.error('--emit-shen requires an output file path');
        process.exitCode = 1;
        return;
      }
    } else if (a === '--help' || a === '-h') {
      printUsage();
      return;
    } else if (a.startsWith('--')) {
      console.error(`Unknown flag: ${a} (ignoring, treating as non-fatal)`);
    } else {
      paths.push(a);
    }
  }

  if (paths.length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const perPathResults = paths.map(runAuditForPath);

  const errors = perPathResults
    .filter((r) => !r.ok)
    .map((r) => ({ path: r.requestedPath, message: r.error }));

  const files = perPathResults
    .filter((r) => r.ok && r.report)
    .flatMap((r) => r.report.files);

  const topLevelUnparsed = perPathResults
    .filter((r) => r.ok && r.report)
    .flatMap((r) => r.report.unparsed.map((u) => ({ ...u, requestedPath: r.requestedPath })));

  const refactoringSuggestions = perPathResults
    .filter((r) => r.ok && r.report)
    .flatMap((r) => r.report.refactoringSuggestions);

  // Aggregate a top-level coverage summary. Prefer each per-path report's
  // own file-header coverage fragment (present even for single-file runs);
  // fall back to summing when present.
  // Sum whenever the mandatory "N/M functions fully analyzed" head parsed
  // (f.coverage.analyzed !== null) -- an unrecognized TRAILING clause (e.g.
  // a future "N module statements skipped" variant we don't yet know the
  // exact wording of) only means `f.coverage.parsed` is false, it does NOT
  // mean analyzed/total/partial/unsupported are untrustworthy; those come
  // from the reliably-formatted head and the specific clauses we DID match.
  // Losing real numbers here just because one trailing clause was novel
  // would silently undercount a working parse -- exactly what "defensive,
  // not fatal" is meant to avoid.
  const coverageTotals = files.reduce(
    (acc, f) => {
      if (f.coverage.analyzed !== null) {
        acc.analyzed += f.coverage.analyzed || 0;
        acc.total += f.coverage.total || 0;
        acc.partial += f.coverage.partial || 0;
        acc.unsupported += f.coverage.unsupported || 0;
        acc.moduleStatementsSkipped += f.coverage.moduleStatementsSkipped || 0;
      }
      return acc;
    },
    { analyzed: 0, total: 0, partial: 0, unsupported: 0, moduleStatementsSkipped: 0 }
  );

  const output = {
    tool: 'freerange-audit',
    generatedAt: new Date().toISOString(),
    requestedPaths: paths,
    files: files.map((f) => ({
      file: f.file,
      coverage: f.coverage,
      functions: f.functions.map((fn) => ({
        name: fn.name,
        requires: fn.requires,
        ensures: fn.ensures.map((e) => ({
          ...e,
          lower: jsonNumber(e.lower !== undefined ? e.lower : null),
          upper: jsonNumber(e.upper !== undefined ? e.upper : null),
        })),
        assumes: fn.assumes,
        proves: fn.proves,
        partiallySupported: fn.partiallySupported,
        unsupported: fn.unsupported,
        onAnalyzedPaths: fn.onAnalyzedPaths,
        skipped: fn.skipped,
        raw: fn.raw,
      })),
      unparsed: f.unparsed,
    })),
    coverage: coverageTotals,
    refactoringSuggestions,
    unparsed: topLevelUnparsed,
    errors,
  };

  if (wantJson) {
    console.log(JSON.stringify(output, null, 2));
  } else {
    // Human-readable summary (default, mirrors cli/check.js's terse style).
    for (const r of perPathResults) {
      if (!r.ok) {
        console.error(`  ✗ ${r.requestedPath}: ${r.error}`);
        continue;
      }
      for (const f of r.report.files) {
        const fnCount = f.functions.length;
        console.log(`${f.file}: ${f.coverage.raw} (${fnCount} function(s) reported)`);
      }
      if (r.report.unparsed.length > 0) {
        console.log(`  (${r.report.unparsed.length} unparsed line(s) -- see --json for detail)`);
      }
    }
  }

  if (emitShenOut) {
    try {
      const { facts, excluded } = buildBoundsFacts(perPathResults);
      const invocation = `node cli/freerange-audit.js ${paths.join(' ')} --emit-shen ${emitShenOut}`;
      const shenSrc = renderShenFile(facts, excluded, paths, invocation);
      fs.mkdirSync(path.dirname(path.resolve(process.cwd(), emitShenOut)), { recursive: true });
      fs.writeFileSync(emitShenOut, shenSrc);
      if (!wantJson) {
        console.log(
          `Wrote ${emitShenOut} (${facts.length} fact(s), ${excluded.length} function(s) excluded -- see file comments)`
        );
      }
    } catch (e) {
      console.error(`Failed to write --emit-shen output ${emitShenOut}: ${e.message}`);
      process.exitCode = 1;
    }
  }
}

// Only run as a CLI when invoked directly (`node cli/freerange-audit.js ...`).
// This file is also required as a library (its own test above, and
// potentially Gate 5's --audit sub-mode) purely for parseAuditText /
// buildBoundsFacts / renderShenFile -- it must not shell out to `fr` or
// touch process.exitCode just because something required() it.
if (require.main === module) {
  // Top-level guard: a genuinely unexpected exception must still not crash
  // with a raw stack trace or a non-zero exit that looks like "the build is
  // broken" when it's really "this tool has a bug." Report it plainly, exit 0
  // per the "never fails the build on parse trouble" contract -- an internal
  // bug in this bridge is not the same class of failure as a real design
  // violation, and should not block other gates.
  try {
    main();
  } catch (e) {
    console.error(`freerange-audit: internal error (degrading to no facts learned): ${e && e.stack ? e.stack : e}`);
    process.exitCode = 0;
  }
}

module.exports = {
  parseAuditText,
  parseNumericProseText,
  parseRequiresText,
  buildBoundsFacts,
  renderShenFile,
  camelToKebab,
};
