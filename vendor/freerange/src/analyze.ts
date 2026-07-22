import {analyzeProgram} from './engine/analyze.ts'
import type {ProgramAnalysis} from './engine/outcome.ts'
import type {ProgramIR} from './ir/program.ts'
import type {CrossFileResolver} from './lower/cross-file.ts'
import {lowerSource} from './lower/program.ts'
import type {CheckedSource} from './typescript/check.ts'

export type DetailedAnalysis = {
  program: ProgramIR
  analysis: ProgramAnalysis
}

// crossFile is undefined for every existing caller (src/index.ts's public API included),
// so single-file analysis is unaffected; src/project.ts's project-scoped commands are the
// only callers that build and pass a resolver, under --cross-file.
export function analyzeCheckedSource(
  checked: CheckedSource,
  baseDirectory?: string,
  crossFile?: CrossFileResolver,
): DetailedAnalysis {
  const program = lowerSource(checked, baseDirectory, crossFile)
  const analysis = analyzeProgram(program)
  return {program, analysis}
}
