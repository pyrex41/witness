// --cross-file's own test coverage, kept separate from tests/project-report.test.ts's
// suite (which does not exercise multiple files importing from each other). See
// WITNESS-FORK.md for the motivating case: a leading console.assert requirement on a
// named top-level function must still gate its caller when the caller imports the
// function from another file, not just when both live in one file.
import {expect, test} from 'bun:test'
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {dirname, join} from 'node:path'

const freerangeCli = new URL('../fr.ts', import.meta.url).pathname

function runCli(cwd: string, ...arguments_: string[]) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, freerangeCli, ...arguments_],
    cwd,
    stdout: 'pipe',
    stderr: 'pipe',
    timeout: 10_000,
  })
  return {
    exitCode: result.exitCode,
    signalCode: result.signalCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
  }
}

function writeProject(directory: string, files: Record<string, string>): void {
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'ESNext',
      module: 'ESNext',
      moduleResolution: 'bundler',
    },
    include: ['**/*.ts'],
  }))
  for (const [file, source] of Object.entries(files)) {
    const path = join(directory, file)
    mkdirSync(dirname(path), {recursive: true})
    writeFileSync(path, source)
  }
}

// The motivating case from WITNESS-FORK.md: a card layout helper whose divisor must be at
// least 1, called with a literal 0 from a different file.
const cardLayoutLibrary = `export function cardActionSlotWidth(available: number, actionCount: number): number {
  console.assert(Number.isInteger(actionCount))
  console.assert(actionCount >= 1)
  return (available - 8 * (actionCount - 1)) / actionCount
}
`

test('a cross-file requirement violation is invisible without --cross-file and caught with it', () => {
  const projectDirectory = mkdtempSync(join(tmpdir(), 'freerange-cross-file-bad-'))
  try {
    writeProject(projectDirectory, {
      'lib.ts': cardLayoutLibrary,
      'consumer.ts': `import {cardActionSlotWidth} from './lib'

export function useIt(): number {
  return cardActionSlotWidth(268, 0)
}
`,
    })

    // Default behavior (the flag absent): unchanged from the unpatched analyzer — the
    // import makes the call, and therefore the whole containing function, unsupported.
    // Unsupported is not itself a finding, so the run stays clean and exits 0.
    const withoutFlag = runCli(projectDirectory)
    expect(withoutFlag.exitCode).toBe(0)
    expect(withoutFlag.stdout).toContain('No lint findings.')
    expect(withoutFlag.stdout)
      .toContain('coverage: 1/2 named top-level function declarations fully analyzed; 0 partially supported; 1 unsupported.')

    // --cross-file resolves the import, applies cardActionSlotWidth's own proven
    // requirements at the call site, and finds actionCount >= 1 definitely false for the
    // literal argument 0.
    const withFlag = runCli(projectDirectory, '--cross-file')
    expect(withFlag.exitCode).toBe(1)
    expect(withFlag.stderr).toBe('')
    expect(withFlag.stdout).toContain(
      'error [declared-requirement]: call to cardActionSlotWidth makes its declared requirement definitely false',
    )
    // The finding sits at the call, in consumer.ts...
    expect(withFlag.stdout).toMatch(/consumer\.ts\(4,\d+\): error \[declared-requirement\]/)
    // ...and the "declared at" location it cites is the requirement's real site, in lib.ts
    // — proving the location was resolved against the callee's own file, not misreported
    // against the caller's.
    expect(withFlag.stdout).toContain('declared at lib.ts(')
    expect(withFlag.stdout).not.toContain('declared at consumer.ts(')
    expect(withFlag.stdout).toContain('1 finding (1 error, 0 warnings).')

    // `fr <file> --cross-file` narrows to consumer.ts and still resolves the import: the
    // resolver is built from the whole project's sources regardless of which file the
    // output is narrowed to.
    const targeted = runCli(projectDirectory, 'consumer.ts', '--cross-file')
    expect(targeted.exitCode).toBe(1)
    expect(targeted.stdout).toContain('call to cardActionSlotWidth makes its declared requirement definitely false')
  } finally {
    rmSync(projectDirectory, {recursive: true, force: true})
  }
})

test('a satisfying cross-file call is clean, and the caller is genuinely analyzed rather than left unsupported', () => {
  const projectDirectory = mkdtempSync(join(tmpdir(), 'freerange-cross-file-good-'))
  try {
    writeProject(projectDirectory, {
      'lib.ts': cardLayoutLibrary,
      'consumer.ts': `import {cardActionSlotWidth} from './lib'

export function useIt(): number {
  return cardActionSlotWidth(268, 4)
}
`,
    })

    const result = runCli(projectDirectory, '--cross-file')
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    expect(result.stdout).toContain('No lint findings.')
    // Both functions are now fully analyzed — not just silently "unsupported" the way an
    // import call always resolved before this flag existed. If cross-file resolution were
    // only suppressing the old unsupported call instead of actually lowering and checking
    // it, this coverage line would still read 1/2 with 1 unsupported, exactly like the
    // flag-off baseline in the sibling test.
    expect(result.stdout)
      .toContain('coverage: 2/2 named top-level function declarations fully analyzed; 0 partially supported; 0 unsupported.')
  } finally {
    rmSync(projectDirectory, {recursive: true, force: true})
  }
})

test('a mutual import cycle terminates under --cross-file instead of recursing forever', () => {
  const projectDirectory = mkdtempSync(join(tmpdir(), 'freerange-cross-file-cycle-'))
  try {
    // a calls b, b calls a: resolving either crossCall's contract requires analyzing the
    // other file, which itself needs the first file's contract. The resolver's per-file
    // "currently analyzing" guard (src/lower/cross-file.ts) must report 'cycle' instead of
    // resolving forever the second time either file comes up mid-chain.
    writeProject(projectDirectory, {
      'a.ts': `import {b} from './b'

export function a(n: number): number {
  console.assert(n >= 0)
  return b(n)
}
`,
      'b.ts': `import {a} from './a'

export function b(n: number): number {
  console.assert(n >= 0)
  return a(n)
}
`,
    })

    const result = runCli(projectDirectory, '--cross-file')
    // The process must exit on its own, not be killed by the 10-second timeout above —
    // Bun.spawnSync reports a timeout kill through signalCode ('SIGTERM' here), so a
    // natural exit is anything else (including bun's own "no signal" value).
    expect(result.signalCode).not.toBe('SIGTERM')
    expect(typeof result.exitCode).toBe('number')
  } finally {
    rmSync(projectDirectory, {recursive: true, force: true})
  }
})
