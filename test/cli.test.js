// test/cli.test.js — CLI integration tests
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
    passed++;
  } catch (err) {
    console.error(`  \u2717 ${name}`);
    console.error(`    ${err.message}`);
    failed++;
  }
}

function run(args, expectFail = false) {
  try {
    const out = execSync(`node cli/check.js ${args}`, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (expectFail) throw new Error('Expected command to fail but it succeeded');
    return out;
  } catch (err) {
    if (!expectFail) throw err;
    return (err.stdout || '') + (err.stderr || '');
  }
}

console.log('=== CLI Tests ===\n');

// Test 1: help
test('witness help shows usage', () => {
  const out = run('help');
  if (!out.includes('Usage:')) throw new Error('Missing usage text');
  if (!out.includes('dev')) throw new Error('Missing dev command');
  if (!out.includes('build')) throw new Error('Missing build command');
  if (!out.includes('check')) throw new Error('Missing check command');
});

test('witness --help shows usage', () => {
  const out = run('--help');
  if (!out.includes('Usage:')) throw new Error('Missing usage text');
});

// Test 2: dev check counter example passes (Tier 1: static text assertions)
test('witness dev examples/counter.shen passes', () => {
  const out = run('dev examples/counter.shen');
  if (!out.includes('passed')) throw new Error('Expected "passed" in output');
});

// Test 3: dev check with overflow should fail
test('witness dev detects overflow', () => {
  const tmp = path.join(os.tmpdir(), `witness-overflow-${Date.now()}.shen`);
  fs.writeFileSync(tmp, `
(assert-fits "This is a very long string that will certainly overflow" (mk-font "Inter" 14) 10)
`);
  try {
    const out = run(`dev ${tmp}`, true);
    if (!out.includes('Layout overflow') && !out.includes('\u2717')) {
      throw new Error('Expected overflow error in output');
    }
  } finally {
    fs.unlinkSync(tmp);
  }
});

// Test 4: no files gives error
test('witness dev with no files shows error', () => {
  const out = run('dev', true);
  if (!out.includes('No files specified')) throw new Error('Expected "No files specified"');
});

// Test 5: agent help
test('witness agent --help shows usage', () => {
  const out = execSync('node cli/agent.js --help', {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 10000,
  });
  if (!out.includes('Self-correcting')) throw new Error('Missing agent description');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
console.log('\n=== All CLI tests passed ===');
