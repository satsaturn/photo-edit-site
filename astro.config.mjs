// @ts-check
import { defineConfig } from 'astro/config';

// GitHub Pages deployment settings.
// Update `site` to match your GitHub username/domain if it differs.
const SITE_URL = 'https://satsaturn.github.io';
const BASE_PATH = '/photo-edit-site/';

// https://astro.build/config
export default defineConfig({
  site: SITE_URL,
  base: BASE_PATH,
  output: 'static',
  trailingSlash: 'always',
});
