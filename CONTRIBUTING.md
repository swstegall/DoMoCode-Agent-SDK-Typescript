# Contributing

Use Node.js 20.4 or newer. Run `npm test`, `npm run check`, and `npm run build` before opening a
change. Keep relative imports in `src/` written with `.ts` extensions so TypeScript can rewrite
them for the committed ESM build. Keep runtime dependencies at zero.

Generated `src/types/generated.ts` and `dist/` changes must be produced by the repository
scripts, never hand-edited.
