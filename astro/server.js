// Astro renderer (server side). Astro calls check() against every component
// instance and uses the first renderer that returns true. We identify our
// components by the marker produced by the vite plugin.

import { renderComponent } from './runtime.js';
import { WITNESS_COMPONENT_MARKER } from './plugin.js';

async function check(Component) {
  return !!(Component && typeof Component === 'object' && Component[WITNESS_COMPONENT_MARKER]);
}

async function renderToStaticMarkup(Component, props /*, slots, metadata */) {
  const filepath = Component[WITNESS_COMPONENT_MARKER];
  const html = await renderComponent(filepath, props);
  return { html };
}

export default {
  name: 'witness',
  check,
  renderToStaticMarkup,
  supportsAstroStaticSlot: true,
};
