// Vite plugin: resolve `.shen` imports to a marker module that the Astro
// renderer (astro/server.js) picks up at render time.
//
// Each imported .shen file becomes a small JS module whose default export is
// a Component marker carrying the absolute filepath. The actual shen load +
// render happens in astro/runtime.js when Astro calls renderToStaticMarkup.

import { invalidate } from './runtime.js';

export const WITNESS_COMPONENT_MARKER = '__witnessShenPath';

export function witnessVitePlugin() {
  return {
    name: 'witness:shen',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!source.endsWith('.shen')) return null;
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      return resolved ? resolved.id : null;
    },
    load(id) {
      if (!id.endsWith('.shen')) return null;
      this.addWatchFile(id);
      return `const Component = { ${JSON.stringify(WITNESS_COMPONENT_MARKER)}: ${JSON.stringify(id)} };\n` +
             `Component.name = ${JSON.stringify(filenameOf(id))};\n` +
             `export default Component;\n`;
    },
    handleHotUpdate(ctx) {
      if (ctx.file.endsWith('.shen')) {
        invalidate(ctx.file);
      }
    },
  };
}

function filenameOf(id) {
  const base = id.split('/').pop() || id;
  return base.replace(/\.shen$/, '');
}
