import { defineConfig } from 'astro/config';

// Static output only: a preview is one self-contained page, no server needed.
export default defineConfig({
  output: 'static',
});
