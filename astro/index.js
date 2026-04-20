// Astro integration entry point. Use it from astro.config.mjs:
//
//   import witness from 'witness/astro';
//   export default defineConfig({ integrations: [witness()] });
//
// Gives .astro files first-class .shen component imports:
//
//   import SiteHeader from '../chrome/SiteHeader.shen';
//   <SiteHeader currentNav="writing" />

import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { witnessVitePlugin } from './plugin.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export default function witness() {
  return {
    name: 'witness',
    hooks: {
      'astro:config:setup': ({ addRenderer, updateConfig }) => {
        addRenderer({
          name: 'witness',
          serverEntrypoint: path.join(HERE, 'server.js'),
        });
        updateConfig({
          vite: {
            plugins: [witnessVitePlugin()],
            ssr: {
              // Keep the witness runtime + shen-script out of Vite's ESM
              // dependency analysis; they're CJS with dynamic loads.
              noExternal: [],
              external: ['witness'],
            },
          },
        });
      },
    },
  };
}
