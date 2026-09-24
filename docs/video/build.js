#!/usr/bin/env node
// docs/video/build.js — builds docs/video/witness-tutorial.mp4 from scenes.js.
//
//   node docs/video/build.js [--only <sceneId,...>] [--out <file.mp4>]
//
// Pipeline, per scene:
//   1. run the scene's commands for real (repo root) and keep their output;
//   2. synthesize the narration sentence by sentence (tts.py), which gives exact
//      sentence start times, so captions and command starts line up with speech;
//   3. step a timeline of discrete states (a command typed one chunk at a time,
//      output revealed a few lines at a time, the caption changing per sentence),
//      screenshot each distinct state in Chromium at 1920x1080;
//   4. ffmpeg: frames (concat demuxer with per-frame durations) + audio -> scene
//      mp4. Then all scenes are concatenated into one file.
//
// Requirements: ffmpeg, python3 with numpy + soundfile, Playwright (global or
// local install), and a voice: Kokoro model files in $KOKORO_DIR for the neural
// voice, or espeak-ng as a fallback. See docs/video/README.md.

const fs = require('fs');
const path = require('path');
const { execSync, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const TMP = process.env.WITNESS_VIDEO_TMP || '/tmp/witness-video';
const args = process.argv.slice(2);
const argVal = f => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
const OUT_FILE = path.resolve(argVal('--out') || path.join(__dirname, 'witness-tutorial.mp4'));
const ONLY = argVal('--only') ? argVal('--only').split(',') : null;

function loadPlaywright() {
  for (const p of ['playwright', path.join(execSync('npm root -g').toString().trim(), 'playwright')]) {
    try { return require(p); } catch (_) { /* try next */ }
  }
  throw new Error('Playwright not found. Install it (npm i -g playwright) — see docs/video/README.md.');
}

const ctx = { read: f => fs.readFileSync(f, 'utf8') };
const allScenes = require('./scenes.js')(ctx);
const scenes = ONLY ? allScenes.filter(s => ONLY.includes(s.id)) : allScenes;

// --- timing (seconds) -------------------------------------------------------
const CHARS_PER_STEP = 3;
const TYPE_STEP = 0.045;      // per CHARS_PER_STEP chars typed
const AFTER_ENTER = 0.35;     // pause between Enter and output
const REVEAL_STEPS = 6;       // output appears in at most this many chunks
const REVEAL_STEP = 0.12;
const BETWEEN_CMDS = 0.6;
const HOLD_END = 1.2;         // minimum hold after the last animation

const stripAnsi = s => s.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
const sentences = scene => scene.narration.map(n => (Array.isArray(n) ? n : [n, n]));

function runCommands(scene) {
  for (const c of scene.commands || []) {
    c.show = c.show || c.run;
    if (c.display !== undefined) { c.output = c.display; continue; }
    let out;
    try {
      out = execSync(c.run, { cwd: ROOT, shell: '/bin/bash', encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 600000 });
    } catch (e) {
      out = (e.stdout || '') + (e.stderr || ''); // non-zero exits are part of the demo
    }
    out = stripAnsi(out).split('\n').filter(l => l.trim()).join('\n');
    if (c.filter) out = c.filter(out);
    c.output = out;
    console.log(`  $ ${c.show}\n${out.split('\n').map(l => '    ' + l).join('\n')}`);
  }
}

function synthesize(scene, dir) {
  const req = path.join(dir, `${scene.id}.json`);
  const wav = path.join(dir, `${scene.id}.wav`);
  fs.writeFileSync(req, JSON.stringify({ sentences: sentences(scene).map(s => s[1]), lead: 0.5, gap: 0.35, tail: 0.5 }));
  const timing = JSON.parse(execFileSync('python3', [path.join(__dirname, 'tts.py'), req, wav], { encoding: 'utf8' }));
  return { wav, ...timing };
}

// Build the list of (time, state) keyframes for a scene.
function timeline(scene, timing) {
  const keys = [];
  const caps = sentences(scene);
  const capAt = t => { let i = 0; timing.starts.forEach((s, j) => { if (t >= s - 0.05) i = j; }); return i; };
  const lines = [];               // committed terminal lines
  let t = 0.6;
  const push = (time, term) => keys.push({ t: time, term: term.slice() });
  push(0, []);
  for (const c of scene.commands || []) {
    if (c.at !== undefined) t = Math.max(t, timing.starts[c.at]);
    for (let n = CHARS_PER_STEP; n < c.show.length + CHARS_PER_STEP; n += CHARS_PER_STEP) {
      push(t, [...lines, { cmd: c.show.slice(0, n), cursor: true }]);
      t += TYPE_STEP;
    }
    lines.push({ cmd: c.show });
    push(t, lines);
    t += AFTER_ENTER;
    const outLines = c.output ? c.output.split('\n') : [];
    const per = Math.max(1, Math.ceil(outLines.length / REVEAL_STEPS));
    for (let i = 0; i < outLines.length; i += per) {
      lines.push(...outLines.slice(i, i + per).map(o => ({ out: o })));
      push(t, lines);
      t += REVEAL_STEP;
    }
    t += BETWEEN_CMDS;
  }
  const end = Math.max(timing.duration, t + HOLD_END);
  // Caption changes are keyframes too.
  timing.starts.forEach(s => keys.push({ t: s - 0.05, capOnly: true }));
  keys.sort((a, b) => a.t - b.t);
  let term = [];
  const frames = [];
  for (const k of keys) {
    if (!k.capOnly) term = k.term;
    const state = { term, cap: caps[capAt(k.t)][0], step: capAt(k.t) };
    const t0 = Math.max(0, k.t);
    if (frames.length && frames[frames.length - 1].t === t0) frames[frames.length - 1].state = state;
    else frames.push({ t: t0, state });
  }
  // Collapse identical consecutive states.
  const out = [];
  for (const f of frames) {
    if (out.length && JSON.stringify(out[out.length - 1].state) === JSON.stringify(f.state)) continue;
    out.push(f);
  }
  return { frames: out, end };
}

function pageHtml() {
  const font = f => fs.readFileSync(path.join(ROOT, 'node_modules/@fontsource/jetbrains-mono/files', f)).toString('base64');
  return fs.readFileSync(path.join(__dirname, 'template.html'), 'utf8')
    .replace('__MONO400__', font('jetbrains-mono-latin-400-normal.woff2'))
    .replace('__MONO700__', font('jetbrains-mono-latin-700-normal.woff2'));
}

async function main() {
  fs.mkdirSync(TMP, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1.5 });
  await page.setContent(pageHtml());
  const sceneFiles = [];

  for (const [i, scene] of scenes.entries()) {
    console.log(`\n[${i + 1}/${scenes.length}] ${scene.id}`);
    const dir = path.join(TMP, scene.id);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });

    runCommands(scene);
    const timing = synthesize(scene, dir);
    const { frames, end } = timeline(scene, timing);
    const slide = typeof scene.slide === 'function' ? scene.slide() : scene.slide || null;
    await page.evaluate(s => window.setScene(s), { kicker: scene.kicker, title: scene.title, slide, terminal: !!scene.commands });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400); // let an iframe srcdoc finish loading

    const list = [];
    for (const [j, f] of frames.entries()) {
      await page.evaluate(st => window.setState(st), f.state);
      const png = path.join(dir, `f${String(j).padStart(4, '0')}.png`);
      await page.screenshot({ path: png });
      const next = j + 1 < frames.length ? frames[j + 1].t : end;
      list.push(`file '${png}'\nduration ${(next - f.t).toFixed(3)}`);
    }
    list.push(`file '${path.join(dir, `f${String(frames.length - 1).padStart(4, '0')}.png`)}'`);
    fs.writeFileSync(path.join(dir, 'frames.txt'), list.join('\n') + '\n');

    const mp4 = path.join(TMP, `${String(i).padStart(2, '0')}-${scene.id}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error',
      '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'frames.txt'),
      '-i', timing.wav,
      '-filter_complex', `[0:v]fps=30,format=yuv420p[v];[1:a]apad=whole_dur=${end.toFixed(3)}[a]`,
      '-map', '[v]', '-map', '[a]', '-t', end.toFixed(3),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-tune', 'stillimage',
      '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', mp4]);
    console.log(`  -> ${frames.length} frames, ${end.toFixed(1)}s`);
    sceneFiles.push(mp4);
  }
  await browser.close();

  const concat = path.join(TMP, 'scenes.txt');
  fs.writeFileSync(concat, sceneFiles.map(f => `file '${f}'`).join('\n') + '\n');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concat,
    '-c', 'copy', '-movflags', '+faststart', OUT_FILE]);
  const dur = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT_FILE]).toString().trim();
  console.log(`\nWrote ${path.relative(process.cwd(), OUT_FILE)} (${Number(dur).toFixed(1)}s, ${(fs.statSync(OUT_FILE).size / 1e6).toFixed(1)} MB)`);
}

main().catch(err => { console.error(err); process.exit(1); });
