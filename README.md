# Photo Edit Site

A minimal photo editing site built with Astro, using a header + sidebar + main layout.

## Project Structure

```text
/
├── .github/workflows/deploy.yml   # GitHub Pages deployment
├── public/                        # Static assets
├── src/
│   ├── components/
│   │   └── tools/
│   │       └── ExampleTool.astro  # Placeholder tool UI
│   ├── layouts/
│   │   └── BaseLayout.astro       # Shared page shell
│   ├── pages/
│   │   ├── index.astro            # Home page
│   │   ├── editor.astro           # Editor / tool UI
│   │   └── about.astro            # About page
│   └── styles/
│       └── global.css             # Minimal grey styling
├── astro.config.mjs               # Astro + GitHub Pages config
└── package.json
```

## Commands

All commands are run from the project root:

| Command           | Action                                       |
| :---------------- | :------------------------------------------- |
| `npm install`     | Installs dependencies                        |
| `npm run dev`     | Starts local dev server at `localhost:4321`  |
| `npm run build`   | Build the production site to `./dist/`       |
| `npm run preview` | Preview the build locally                    |

## Deploy to GitHub Pages

1. Push this repo to GitHub.
2. Go to **Settings > Pages**.
3. Under **Build and deployment**, select **GitHub Actions**.
4. The workflow in `.github/workflows/deploy.yml` will build and deploy the site automatically on pushes to `main`.

If your GitHub username is not `hughc`, update the `site` value in `astro.config.mjs`.
