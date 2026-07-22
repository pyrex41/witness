#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { boot } = require('../boot');

const HELP = `Usage: witness <command> [options] [files...]

Commands:
  dev <files...>        Tier 1: static text checks (assert-fits at load time)
  build <files...>      Tier 1 with type checking (tc+)
  check [options] <files...>
    --full              Tier 1 with type checking (tc+)
    --figma <spec.json> Tier 3: Figma structural diff
    --expr <shen>       Shen expression for Figma compare (default: (render-view))
    --tolerance <px>    Figma pixel tolerance (default: 2)
    --sbcl              Use SBCL Shen for proof checking (faster)
  render <file.shen>    Render layout to HTML (SSR)
    --output <file>     Write to file (default: stdout)
    --expr <shen>       Shen expression (default: (render-view))
    --width <px>        Viewport width (default: 800)
    --height <px>       Viewport height (default: 600)
  measure <files...>    Pre-compute text measurements for SBCL proof checking
  gates                 Run sb-style design fidelity gates (Gates 1-4: tc+, proofs, TCB audit, emitter fidelity for Card)
                          Supports --quick, --gate N, --emit (for Gate 4 regeneration)
  design-gates          Alias for gates
  codegen                 Thin official 'witness codegen' surface (Card emitter starting point)
                          Supports --emit (write), --help. Delegates to codegen/emitters/card-emitter.js
  agent <files...>      Self-correcting layout agent (auto-widen on overflow proofs)
    --max-iter N
    --dry-run
    --respect-design-gates   Make design gates first-class: run chosen gates each iter;
                             gate failures surface as high-prio DESIGN SPEC VIOLATION
                             with full output + remediation (edit spec OR impl)
    --gate <quick|full|N>    Gate mode when respecting (quick default; full for TCB+emitter;
                             4 for emitter-only work on Card spike)
  loop <files...>       Gate-protected Ralph-style autonomous loop (first-class protected dev env)
                        Delegates to bin/witness-loop.sh for banner + flexible gate selection.
                        Runs design gates (configurable: --gate quick|full|4|audit...) *before each*
                        agent iteration. Violations are rich, actionable backpressure blocks.
                        Use for Card spike, emitter, specs/design evolution under proof.
    --max-iter N
    --dry-run
    --gate <spec>
                        Creates skeleton *-properties.shen + *-emitter.js (with fidelityChecks),
                        then auto-wires via the tiny generic component loader (no hand edits
                        boilerplate and green gates in <2 min.
    --force             Overwrite existing
    --dry-run           Preview only
  help                  Show this help

Use 'witness gates' (or npm run gates) regularly while evolving the project
(especially the Shen UI Specs / Card spike layer).
Use 'witness loop' (or the witness-loop binary) for gate-protected
agent work on specs/ or core implementation. The loop + gates turn the
terminal into a live verified environment for the self-hosting UI spec system.

`;

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';

  if (command === 'help' || command === '--help') {
    console.log(HELP);
    return;
  }

  // render command — SSR: load file, compute layout, emit HTML
  if (command === 'render') {
    const flagArgs = new Map();
    const renderFiles = [];
    const flags = ['--output', '--expr', '--width', '--height'];
    for (let i = 1; i < args.length; i++) {
      if (flags.includes(args[i]) && i + 1 < args.length) {
        flagArgs.set(args[i], args[++i]);
      } else if (!args[i].startsWith('--')) {
        renderFiles.push(args[i]);
      }
    }
    if (!renderFiles.length) {
      console.error(`Usage: witness render <file.shen> [options]
  --output <file>   Write HTML to file (default: stdout)
  --expr <shen>     Shen expression returning a node (default: render-view)
  --width <px>      Viewport width (default: 800)
  --height <px>     Viewport height (default: 600)`);
      process.exitCode = 1;
      return;
    }
    const width = parseInt(flagArgs.get('--width') || '800', 10);
    const height = parseInt(flagArgs.get('--height') || '600', 10);
    const expr = flagArgs.get('--expr') || '(render-view)';
    const outputFile = flagArgs.get('--output');

    const $ = await boot();
    await $.exec('(tc -)');
    await $.load(path.resolve(renderFiles[0]));
    const htmlStr = await $.exec(
      `(render-html-doc (solve-layout ${expr} ${width} ${height}))`
    );
    if (outputFile) {
      fs.writeFileSync(outputFile, htmlStr);
      console.log(`Wrote ${outputFile}`);
    } else {
      console.log(htmlStr);
    }
    return;
  }

  // measure command — delegates to cli/measure.js
  if (command === 'measure') {
    const { execSync } = require('child_process');
    const measureFiles = args.slice(1);
    execSync(`node ${__dirname}/measure.js ${measureFiles.join(' ')}`, { stdio: 'inherit' });
    return;
  }

  // gates / design-gates — sb-style backpressure for Witness itself
  if (command === 'gates' || command === 'design-gates') {
    const { execSync } = require('child_process');
    const gateScript = path.join(__dirname, '..', 'bin', 'witness-design-gates.sh');
    // Forward remaining args (e.g. --quick, --gate 4, --emit)
    const gateArgs = args.slice(1).join(' ');
    try {
      execSync(`bash ${gateScript} ${gateArgs}`.trim(), { stdio: 'inherit' });
    } catch (e) {
      process.exitCode = e.status || 1;
    }
    return;
  }

  // codegen — thin official `witness codegen` surface for Card (and future emitters)
  // Delegates to the real card-emitter (Gate 4 implementation) so `witness codegen --emit` works
  // without users invoking node directly on the internal emitter path.
  if (command === 'codegen') {
    if (args.includes('--help') || args.includes('-h')) {
      console.log(`Usage: witness codegen [options]

Thin official entry point for the shen-witness codegen layer (Card spike is the initial target).

Options:
  --emit, --write     Write the emitted Card.tsx + card.css to codegen/emitters/generated/card/
  (default: preview the sources to stdout)

See specs/ui/card-spec.shen, codegen/emitters/card-emitter.js, Gate 4 (emitter fidelity),
and specs/design/README.md (Extending the system).
`);
      return;
    }
    const { execSync } = require('child_process');
    const emitterPath = path.join(__dirname, '..', 'codegen', 'emitters', 'card-emitter.js');
    const codegenArgs = args.slice(1).join(' ');
    try {
      execSync(`node ${emitterPath} ${codegenArgs}`.trim(), { stdio: 'inherit' });
    } catch (e) {
      process.exitCode = e.status || 1;
    }
    return;
  }

  // agent — delegate (now supports --respect-design-gates for gate-aware runs)
  if (command === 'agent') {
    const { execSync } = require('child_process');
    const agentArgs = args.slice(1).join(' ');
    try {
      execSync(`node ${__dirname}/agent.js ${agentArgs}`, { stdio: 'inherit' });
    } catch (e) {
      process.exitCode = e.status || 1;
    }
    return;
  }

  // loop — launches the gate-aware Ralph-style loop (forces design gate respect)
  // Delegates to dedicated bin/witness-loop.sh which provides the rich banner,
  // supports --gate quick|full|N etc., and ensures --respect-design-gates + chosen gate
  // are passed down. This is the first-class entry point for the protected dev environment.
  // Exactly the integration point for /witness:loop and sb-style autonomous backpressure.
  if (command === 'loop') {
    const { execSync } = require('child_process');
    const loopArgs = args.slice(1).join(' ');
    try {
      execSync(`bash ${__dirname}/../bin/witness-loop.sh ${loopArgs}`, { stdio: 'inherit' });
    } catch (e) {
      process.exitCode = e.status || 1;
    }
    return;
  }

  // --sbcl flag — delegates to bin/witness-check.sh
  if (args.includes('--sbcl')) {
    const { execSync } = require('child_process');
    const sbclFiles = args.filter(a => !a.startsWith('--') && a !== command);
    try {
      execSync(`bash ${__dirname}/../bin/witness-check.sh ${sbclFiles.join(' ')}`, { stdio: 'inherit' });
    } catch (e) {
      process.exitCode = 1;
    }
    return;
  }

  const $ = await boot();

  // Parse flags
  const figmaIdx = args.indexOf('--figma');
  const figmaSpec = figmaIdx !== -1 ? args[figmaIdx + 1] : null;
  const exprIdx = args.indexOf('--expr');
  const figmaExpr = exprIdx !== -1 ? args[exprIdx + 1] : '(render-view)';
  const toleranceIdx = args.indexOf('--tolerance');
  const figmaTolerance = toleranceIdx !== -1 ? args[toleranceIdx + 1] : '2';
  const hasFull = args.includes('--full');
  // Strip flags and their values from positional args
  const flagsWithValues = ['--figma', '--expr', '--tolerance'];
  const files = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      if (flagsWithValues.includes(a)) i++; // skip the value too
      continue;
    }
    files.push(a);
  }

  // Figma structural verification mode
  if (figmaSpec && files.length > 0) {
    console.log(`Verifying ${files[0]} against Figma spec ${figmaSpec} (tolerance: ${figmaTolerance}px, expr: ${figmaExpr})...`);
    try {
      await $.exec('(tc -)');
      await $.load(path.resolve(files[0]));
      const result = await $.exec(`(verify-figma "${figmaSpec}" ${figmaExpr} ${figmaTolerance})`);
      const arr = $.toArray(result);
      const tag = arr[0];
      const tagStr = typeof tag === 'symbol' ? $.nameOf(tag) : tag;
      if (tagStr === 'pass') {
        console.log(`  \u2713 ${arr[1] || 'All nodes within tolerance'}`);
      } else {
        console.error('  \u2717 Figma verification failed: structural drift detected');
        for (let i = 1; i < arr.length; i++) {
          console.error(`    ${JSON.stringify(arr[i])}`);
        }
        process.exitCode = 1;
      }
    } catch (err) {
      console.error(`  \u2717 ${err.message}`);
      process.exitCode = 1;
    }
    return;
  }

  if (files.length === 0) {
    console.error('No files specified. Run "witness help" for usage.');
    process.exitCode = 1;
    return;
  }

  // Tier selection based on command:
  //   dev   = Tier 1 only (assert-fits at load time, tc- so no type sigs needed)
  //   build = Tier 1 + 2 (tc+ for full type checking)
  //   check = defaults to dev behavior; --full enables tc+
  const useTypeChecking = command === 'build' || hasFull;

  if (!useTypeChecking) {
    // Disable type checking so files can define functions without signatures.
    // assert-fits still runs (it's a runtime check during load).
    await $.exec('(tc -)');
  }

  const OVERFLOW_RE = /Layout overflow: '(.+?)' in (.+?) = ([\d.]+)px, container = ([\d.]+)px/;

  async function printStructuredReport(message) {
    const m = message.match(OVERFLOW_RE);
    if (!m) return false;
    const [, text, font, measured, available] = m;
    try {
      const report = await $.exec(
        `(format-error (make-layout-error "${text}" "${font}" ${measured} ${available}))`
      );
      console.error(`    ${report.split('\n').join('\n    ')}`);
      return true;
    } catch {
      return false;
    }
  }

  for (const file of files) {
    console.log(`Checking ${file}...`);
    try {
      await $.load(path.resolve(file));
      console.log(`  \u2713 ${file} passed`);
    } catch (err) {
      console.error(`  \u2717 ${file}: ${err.message}`);
      await printStructuredReport(err.message);
      process.exitCode = 1;
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
