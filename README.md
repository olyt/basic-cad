# basic-cad

A browser-based 2D CAD editor built with Vue 3, TypeScript, and Vite.

## Local development

Use Node.js **24.15.0** and npm **11.12.1**. The Node version is recorded in
`.nvmrc`. If you use nvm:

```sh
nvm install
nvm use
npm ci
npm run dev
```

Open the local URL printed by Vite. The server binds to `127.0.0.1`.

| Command                  | Purpose                                                |
| ------------------------ | ------------------------------------------------------ |
| `npm run dev`            | Start the development server with hot reload           |
| `npm run build`          | Typecheck and build the app into `dist/`               |
| `npm run preview`        | Serve the production build locally                     |
| `npm run check`          | Typecheck, lint, and check formatting                  |
| `npm run typecheck`      | Check Vue components, tooling, tests, and pure modules |
| `npm run typecheck:pure` | Check pure CAD modules without browser globals         |
| `npm run lint`           | Run ESLint                                             |
| `npm run format`         | Apply Prettier formatting                              |
| `npm test`               | Run Vitest once                                        |
| `npm run test:watch`     | Run Vitest in watch mode                               |
