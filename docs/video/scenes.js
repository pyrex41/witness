// docs/video/scenes.js — the tutorial video, scene by scene.
//
// Each scene has narration (one entry per sentence; a [caption, spoken] pair
// when the words on screen and the pronunciation should differ) and either
// terminal commands or a slide.
//
// Terminal commands really run, from the repo root, when the video is built.
// Nothing on screen is typed by hand. `show` is the command as displayed; it
// defaults to `run`. `at` is the index of the sentence the command waits for.
// `filter` trims long output before it is shown.

const OUT = process.env.WITNESS_VIDEO_TMP || '/tmp/witness-video';

module.exports = (ctx) => [
  {
    id: 'intro',
    kicker: 'Witness · tutorial',
    title: 'Layout overflow as a compile-time error',
    slide: `
      <div class="hero">
        <div class="hero-code"><span class="k">(assert-fits</span> <span class="s">"Submit"</span> <span class="k">(mk-font</span> <span class="s">"Inter"</span> 14<span class="k">)</span> 96<span class="k">)</span></div>
        <ul class="bullets">
          <li data-at="1">Install it</li>
          <li data-at="1">Watch a proof pass, and one fail</li>
          <li data-at="1">Render, auto-fix, gate</li>
          <li data-at="1">See where each piece runs</li>
        </ul>
      </div>`,
    narration: [
      "This is Witness. It turns text overflow into a compile-time error: if a label doesn't fit its box, the build fails, before anything ships.",
      "In the next few minutes we'll install it, watch a proof pass, watch one fail, and see where each piece runs.",
    ],
  },
  {
    id: 'where',
    kicker: 'Before we start',
    title: 'Where does Witness run?',
    slide: `
      <div class="cols">
        <div class="col" data-at="1">
          <h3>Build side: the proofs</h3>
          <p class="where">Node.js 20+, on your laptop or in CI</p>
          <ul>
            <li>Shen runs in-process (ShenScript), so there's no Shen install</li>
            <li>Pretext measures text on <code>node-canvas</code>, so there's no browser</li>
            <li>macOS or Linux</li>
          </ul>
        </div>
        <div class="arrow" data-at="3">proofs erased &rarr;</div>
        <div class="col" data-at="3">
          <h3>Ship side: what you deploy</h3>
          <ul>
            <li>Static HTML (<code>witness render</code>)</li>
            <li>Astro sites (<code>witness/astro</code>)</li>
            <li>Typed React/TSX from the emitter</li>
            <li>Any Shen port (the proof core, tree-shaken)</li>
          </ul>
        </div>
      </div>`,
    narration: [
      "First, the question people ask most: where does Witness actually run?",
      "There are two sides. The proofs run at build time, in Node JS, on your laptop or in CI.",
      "You don't install a Shen compiler, because Shen runs in-process. And there's no browser, because text is measured on a node canvas.",
      "What you ship is different. The proofs are erased, and what's left is plain output: static HTML, an Astro site, or typed React components from the emitter.",
    ],
  },
  {
    id: 'install',
    kicker: 'Step 0',
    title: 'Install',
    commands: [
      { show: 'git clone https://github.com/pyrex41/witness && cd witness', display: "Cloning into 'witness'...", at: 0 },
      { run: 'npm install --no-fund --no-audit 2>&1', show: 'npm install', filter: out => out.split('\n').filter(l => /up to date|added \d+|changed \d+/.test(l)).join('\n'), at: 0 },
      { run: 'npm test 2>&1 | grep -E "[0-9]+ passed, [0-9]+ failed"', show: 'npm test', at: 2 },
    ],
    narration: [
      "Installing is a git clone and an npm install.",
      "On Linux, the canvas module may need the Cairo and Pango dev packages. The tutorial lists them.",
      "Then run npm test to check your setup. Every block should end in zero failed.",
    ],
  },
  {
    id: 'pass',
    kicker: 'Step 1',
    title: 'A proof that passes',
    commands: [
      { run: 'grep "^(assert-fits" specs/ui/card-spec.shen', at: 0 },
      { run: 'node cli/check.js dev examples/card.shen 2>&1', at: 2 },
    ],
    narration: [
      "Here's a card: a title and two buttons, each in a box of fixed width.",
      "Each assert-fits is an obligation: this string, in this font, fits in this many pixels.",
      "Loading the file runs every one of them. It really measures each string with Pretext. Everything fits, so the check passes.",
    ],
  },
  {
    id: 'fail',
    kicker: 'Step 2',
    title: "An overflow that doesn't compile",
    commands: [
      { run: 'grep "^(assert-fits" examples/card-overflow.shen', at: 0 },
      { run: 'node cli/check.js dev examples/card-overflow.shen 2>&1; echo "exit code: $?"', show: 'node cli/check.js dev examples/card-overflow.shen; echo "exit code: $?"', at: 1,
 },
    ],
    narration: [
      "Now change one thing: make the title long.",
      "The same check measures the new title at more than four hundred pixels. The box is two hundred and sixty-eight, so the file refuses to load.",
      "The exit code is non-zero, so CI goes red.",
      "And the error is structured: an error code, the exact measurement, and ranked fixes.",
    ],
  },
  {
    id: 'fonts',
    kicker: 'Why your numbers may differ',
    title: 'The ruler uses the build machine’s fonts',
    slide: `
      <table class="t">
        <tr><th></th><th>macOS</th><th>Linux</th></tr>
        <tr><td><code>sans-serif</code> resolves to</td><td>Helvetica / Arial</td><td>DejaVu Sans</td></tr>
        <tr data-at="1"><td>long title @ 18px</td><td>~410px</td><td>~462px</td></tr>
        <tr data-at="1"><td>fits in 268px?</td><td class="bad">no</td><td class="bad">no</td></tr>
      </table>
      <div class="note" data-at="2">For real projects, register your actual font files in <code>.witness/fonts.json</code>, so the proof measures what users see.</div>`,
    narration: [
      "One detail explains most mismatched numbers: the ruler uses the fonts installed on the build machine.",
      "Generic sans-serif is Helvetica on a Mac and DejaVu on most Linux boxes. The pixel counts differ, but the verdict is the same.",
      ["For real projects, register your actual font files in .witness/fonts.json, so the proof measures what users actually see.", "For real projects, register your actual font files in dot witness slash fonts dot json, so the proof measures what users actually see."],
    ],
  },
  {
    id: 'render',
    kicker: 'Step 3',
    title: 'Render the proven layout',
    commands: [
      { run: `mkdir -p ${OUT} && node cli/check.js render examples/card.shen --output ${OUT}/card.html 2>&1`,
        show: `node cli/check.js render examples/card.shen --output ${OUT}/card.html`, at: 0 },
    ],
    narration: [
      "The proven layout renders straight to static HTML.",
      "Every box position comes from the Yoga layout that was computed at build time.",
    ],
  },
  {
    id: 'browser',
    kicker: 'Step 3',
    title: 'card.html in a browser',
    slide: () => `
      <div class="browser">
        <div class="bar"><span></span><span></span><span></span><div class="url">file://${OUT}/card.html</div></div>
        <div class="view"><iframe srcdoc="${ctx.read(`${OUT}/card.html`)
          .replace('</style>', 'body{margin:24px!important}div{outline:1px dashed rgba(60,100,220,.45)}</style>')
          .replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"></iframe></div>
      </div>
      <div class="note">Unmodified <code>witness render</code> output. The dashed outlines were added for this video to show each layout box.</div>`,
    narration: [
      "Here it is in a browser.",
      "The description is dynamic, so it went through handled-text. It truncates with a real CSS ellipsis instead of breaking the card.",
    ],
  },
  {
    id: 'agent',
    kicker: 'Step 4',
    title: 'Let an agent fix it',
    commands: [
      { run: 'cp examples/card-overflow.shen /tmp/fix-me.shen', at: 2 },
      { run: 'node cli/agent.js /tmp/fix-me.shen 2>&1', at: 2,
        filter: out => out.split('\n').filter(l => /Iteration|Applied|Done|\[W/.test(l)).join('\n') },
      { run: 'diff examples/card-overflow.shen /tmp/fix-me.shen; true', show: 'diff examples/card-overflow.shen /tmp/fix-me.shen', at: 3,
        filter: out => out.split('\n').filter(l => /^[<>]/.test(l)).map(l => l.replace(/\s+/g, ' ').slice(0, 96)).join('\n') },
    ],
    narration: [
      "Because the errors are structured, an agent can fix them.",
      "The agent loop reads the error, applies the top fix it can make mechanically, which here means widening the container, and re-checks until the file is clean.",
      "It rewrites files in place, so run it on a copy.",
      "Two iterations, and the container went from two sixty-eight to wide enough.",
    ],
  },
  {
    id: 'gates',
    kicker: 'Step 5',
    title: 'The design gates',
    commands: [
      { run: 'npm run gates 2>&1 | grep -E "(✓|✗) Gate [0-9]"', show: 'npm run gates', at: 1,
        filter: out => out.replace(/\s*\(.*?\)\s*/g, '  ').replace(/\s+\[/g, '  [') },
    ],
    narration: [
      "The same machinery guards Witness's own components.",
      "npm run gates runs four gates. Gate one type-checks the design specs against real measurements.",
      "Gate two runs the property theorems. Gate three checks that the generated React code still matches its contract.",
      "And gate four runs freerange over the generated TypeScript. CI runs all four on every push.",
    ],
  },
  {
    id: 'freerange',
    kicker: 'Step 6',
    title: 'Numeric bounds on layout math',
    commands: [
      { run: 'grep -n "return gridItemWidth(200)" examples/ts/grid-layout-broken.ts', show: 'grep -n gridItemWidth examples/ts/grid-layout-broken.ts | tail -1', at: 1 },
      { run: 'cd "$(mktemp -d)" && "$OLDPWD/node_modules/.bin/fr" "$OLDPWD/examples/ts/grid-layout-broken.ts" 2>&1',
        show: '(cd "$(mktemp -d)" && "$OLDPWD/node_modules/.bin/fr" "$OLDPWD/examples/ts/grid-layout-broken.ts")', at: 2,
        filter: out => out.replace(/(\.\.\/)+home\/user\/witness\//g, '').split('\n').filter(l => /error|finding/.test(l)).join('\n') },
    ],
    narration: [
      "Proofs cover text. freerange covers the arithmetic around it by checking numeric ranges statically.",
      "In this broken grid, a sidebar breakpoint passes two hundred pixels, which is below the two hundred forty pixel minimum column, so the column count would floor to zero and the width would divide by it.",
      "freerange flags that call before anything runs.",
      "One gotcha: the broken file is excluded from the project tsconfig, so run it from a neutral directory, like this.",
    ],
  },
  {
    id: 'figma',
    kicker: 'Step 7 · work in progress',
    title: 'Figma structural diff',
    commands: [
      { run: 'node cli/check.js check --figma examples/card-design.json examples/card.shen 2>&1', at: 1,
        filter: out => out.split('\n').slice(1, 5).join('\n') + '\n    …' },
    ],
    narration: [
      "Last is the Figma diff, which is still a work in progress.",
      "It compares positions and sizes, not pixels, against a Figma-style export.",
      "Against the bundled fixture it reports drift. The fixture says the title spans the full width, but in code it shrinks to fit its text.",
      "That's the check doing its job, but there's no passing run to show here yet.",
    ],
  },
  {
    id: 'outro',
    kicker: 'Next steps',
    title: 'Try it yourself',
    slide: `
      <ul class="bullets big">
        <li><code>docs/TUTORIAL.md</code>: every command from this video</li>
        <li data-at="1"><code>docs/CONSUMING.md</code>: run the gates on your own project</li>
        <li data-at="1"><code>README.md</code>: the tier model and what's implemented</li>
      </ul>
      <div class="repo">github.com/pyrex41/witness</div>`,
    narration: [
      "Every command in this video, ready to copy and paste, is in docs slash TUTORIAL dot md.",
      "Start there, then read CONSUMING dot md to run the gates on your own project. Thanks for watching.",
    ],
  },
];
