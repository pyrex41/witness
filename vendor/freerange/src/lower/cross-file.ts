// Resolves an imported call target to another project file's own console.assert
// requirements, under --cross-file. See WITNESS-FORK.md for why this exists and current-
// decisions.md's "Procedure specifications... for imported functions" entry for the design
// this follows: analyze the callee's own file (when its source is available) rather than
// trust an unverified sidecar contract.
//
// This file takes analyzeCheckedSource as a plain function reference (imported below) but
// deliberately exposes only TYPES to src/lower/context.ts and src/lower/expression.ts —
// they import type {CrossFileResolver}, which TypeScript erases at compile time. That keeps
// the module graph's runtime edges one-directional (this file depends on the lowering/
// engine pipeline; the pipeline's lowering step depends only on this file's types), even
// though analyze.ts -> lower/program.ts -> lower/expression.ts would otherwise close a
// runtime cycle back to this file. current-decisions.md already treats a type-only cycle as
// a non-issue; this module is built so the cycle never becomes a value-level one.
import {resolve as resolvePath} from 'node:path'
import * as ts from 'typescript'
import {analyzeCheckedSource} from '../analyze.ts'
import type {ProgramAnalysis} from '../engine/outcome.ts'
import type {CrossFileContract, CrossFileRequirement} from '../ir/instructions.ts'
import {reportPath, siteLocation, type ProgramIR} from '../ir/program.ts'

export type CrossFileFileSource = {sourceFile: ts.SourceFile; checker: ts.TypeChecker}

export type CrossFileResolveResult =
  | {kind: 'contract'; contract: CrossFileContract}
  // An import cycle: resolving this call would re-enter a file already being analyzed for
  // this same resolution chain. No contract produced mid-cycle would be trustworthy, so
  // reporting nothing here is sound rather than merely convenient — the same standing
  // assumption current-decisions.md already states for single-file analysis (no runtime
  // import cycle brings a partner module in before this module's own initializer runs)
  // extends here to "no analysis cycle produces a usable contract".
  | {kind: 'cycle'}
  // The callee is not eligible for cross-file enforcement: not a project source file, not a
  // named top-level function declaration, or its own analysis has any stop at all (kind
  // other than 'analyzed'). A callee with a stop has an incomplete requirement list — one
  // more requirement might sit past the stop — and publishing an incomplete list would let
  // a caller pass as "checked" a call that was never actually verified.
  | {kind: 'unsupported'}

export type CrossFileResolver = {
  resolve(declaration: ts.FunctionDeclaration): CrossFileResolveResult
}

// Caps how many files deep one call chain may resolve — the cross-file peer of the
// engine's existing 16-round loop-header fixed-point cap and valueKind's 8-level recursion
// cap. A real bound on real work, not a tuned constant: a project's call graph should never
// approach it outside a mutual-import cycle, which the cycle guard below already catches
// directly.
const maximumCrossFileDepth = 8

// One resolver per `fr` run, built once over every project source file (see
// src/project.ts) and threaded down through lowering. Memoizes both by file (a file
// imported by many callers is analyzed once) and by function name within that file, and
// tracks which files are mid-resolution so a mutual-import cycle terminates instead of
// recursing forever.
export function createCrossFileResolver(sources: Map<string, CrossFileFileSource>): CrossFileResolver {
  const fileAnalysis = new Map<string, {program: ProgramIR; analysis: ProgramAnalysis} | null>()
  const contractsByFile = new Map<string, Map<string, CrossFileResolveResult>>()
  const analyzing = new Set<string>()

  // Analyzing the callee's file may itself lower cross-file calls into other files —
  // resolver.resolve calls back into this same closure. Declared before resolver so
  // analyzeFile can pass it to analyzeCheckedSource; assigned once resolver exists.
  let resolver: CrossFileResolver

  function analyzeFile(file: string): {program: ProgramIR; analysis: ProgramAnalysis} | null {
    const cached = fileAnalysis.get(file)
    if (cached !== undefined) return cached
    const source = sources.get(file)
    if (source == null) {
      fileAnalysis.set(file, null)
      return null
    }
    const result = analyzeCheckedSource(source, undefined, resolver)
    fileAnalysis.set(file, result)
    return result
  }

  resolver = {
    resolve(declaration) {
      const name = declaration.name?.text
      if (name == null) return {kind: 'unsupported'}
      const file = resolvePath(declaration.getSourceFile().fileName)
      let contracts = contractsByFile.get(file)
      if (contracts == null) {
        contracts = new Map()
        contractsByFile.set(file, contracts)
      }
      const cached = contracts.get(name)
      if (cached != null) return cached

      if (analyzing.has(file)) return {kind: 'cycle'}
      if (analyzing.size >= maximumCrossFileDepth) return {kind: 'unsupported'}

      analyzing.add(file)
      let result: CrossFileResolveResult
      try {
        const analyzed = analyzeFile(file)
        result = analyzed == null ? {kind: 'unsupported'} : contractFor(name, analyzed)
      } finally {
        analyzing.delete(file)
      }
      contracts.set(name, result)
      return result
    },
  }
  return resolver
}

function contractFor(name: string, analyzed: {program: ProgramIR; analysis: ProgramAnalysis}): CrossFileResolveResult {
  const index = analyzed.program.functions.findIndex(fn => fn.name === name)
  if (index < 0) return {kind: 'unsupported'}
  const fn = analyzed.analysis.functions[index]
  if (fn == null || fn.kind !== 'analyzed') return {kind: 'unsupported'}
  const requirements: CrossFileRequirement[] = []
  for (const precondition of fn.preconditions) {
    if (precondition.kind !== 'declaredComparison' && precondition.kind !== 'declaredNumberCheck') continue
    const location = siteLocation(analyzed.program, precondition.site)
    requirements.push({
      precondition,
      declarationFile: reportPath(analyzed.program),
      declarationLine: location.line,
      declarationColumn: location.column,
    })
  }
  return {kind: 'contract', contract: {calleeName: name, requirements}}
}
