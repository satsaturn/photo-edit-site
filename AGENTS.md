# Photo Edit Site

A test photo editing site built with Astro.

## Tech stack

- Astro (static output)
- Plain CSS, no frameworks
- Client-side image processing (canvas/WASM)
- GitHub Pages deployment

## Layout

Every page uses `BaseLayout.astro` which provides:

- Thin header (1 line)
- Left sidebar with a vertical tool list
- Main content area

Add new tools by:
1. Adding an entry to the `tools` array in `src/layouts/BaseLayout.astro`
2. Creating a component in `src/components/tools/`
3. Rendering it on a page in `src/pages/`

## Styling

- Light grey palette, minimal, no frills
- CSS variables in `public/styles/global.css`
- Plain CSS only — no Tailwind, no frameworks unless discussed first

## Deployment

- GitHub Pages: `https://satsaturn.github.io/photo-edit-site/`
- Auto-deploys from `main` via `.github/workflows/deploy.yml`
- Base path: `/photo-edit-site/`

## Roadmap

- [x] Basic structure and layout
- [x] Example tool placeholder
- [ ] Image upload / canvas shell
- [ ] First real effect (e.g. pixel sort)
- [ ] Download / export
- [ ] More effects
