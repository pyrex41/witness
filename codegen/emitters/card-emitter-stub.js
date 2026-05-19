/**
 * codegen/emitters/card-emitter-stub.js
 *
 * HISTORICAL / ARCHIVAL design sketch only.
 *
 * The active, Gate-4-wired emitter is:
 *   codegen/emitters/card-emitter.js
 * (real implementation: boots Shen, loads contracts via witness-core,
 *  uses live card-contract-shape, emits branded TS + semantic CSS + stories,
 *  exercised by `witness gates --gate 4` and `witness codegen`).
 *
 * This stub file is kept for provenance. It is never executed by the
 * current gates, CLI, or loop. Do not add new logic here.
 *
 * The design vision it sketched (sb-style branded factories from verified
 * datatypes, semantic CSS, regeneration as enforcement) is realized in
 * the sibling card-emitter.js + the Card contracts in specs/ui/properties/.
 */

module.exports = {
  name: 'card-emitter-stub',
  description: 'Future emitter for specs/ui/card-spec.shen → guarded Card.tsx + semantic card.css',
  // TODO (when implementing PR 4):
  // emit({ specPath: 'specs/ui/card-spec.shen', targets: ['react', 'css'], dryRun: false })
  //   .then(files => writeFiles(files))
  emit: async () => {
    console.log('[card-emitter-stub] This is a stub. Real shen-witness codegen not yet wired.');
    console.log('When implemented it will walk the verified-card datatype in card-spec.shen');
    console.log('and emit the branded factories + the jvns-style semantic CSS.');
    return {
      'Card.tsx': '// GENERATED — do not edit. See card-emitter-stub.js and specs/ui/card-spec.shen',
      'card.css': '/* GENERATED semantic CSS from the Card spec */'
    };
  }
};
