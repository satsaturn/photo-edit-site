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

Tool-specific CSS/JS:
- Static assets (CSS, JS, fonts) go in `public/tools/<tool-name>/`
- Load them via `<link slot="head">` and `<script src="" defer>` in the page component
- Scope all CSS under `.tool-name` to avoid conflicts with the layout

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
- [x] Pixelate tool (Pixless Camera Emulator)
- [ ] More effects
