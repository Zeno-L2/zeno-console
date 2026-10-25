# AGENTS.md: zeno-console

One Vue app, Zeno Console, for the Zeno L2 on Zenon. Anyone reads the chain without a wallet. With a wallet connected, the app also deploys, calls and manages WASM contracts, handles withdrawals and gives the network administrator an area for the admin methods.

## Rules

- The app holds no keys and has no wallet code. It builds unsigned `AccountBlockTemplate`s with `znn-typescript-sdk` and asks the user's browser wallet to sign and publish them through the injected provider (`window.zenon`, `znn_*` requests).
- Follow `nom-rpc-browser`'s architecture: service classes in `core/*-service.ts` with `getInstance()` singletons, composables in `core/composables/use*.ts` over module-level `ref`s, pages in `pages/`, components in `components/`. No Pinia or Vuex.
- Follow the design system exactly (`nom-ui/docs/brand-guidelines.md`): `Address` for addresses and hashes, `Amount` for amounts, semantic tokens only, plasma on one primary action, `text-ledger` labels, Lucide icons, both themes.
- Add a missing generic component to `nom-ui`, never an ad hoc copy here.
- The wallet adapter (`core/wallet-provider-service.ts`) loads only through `loadWallet()` in `core/wallet-loader.ts`, so a visitor who never connects downloads none of it. Lint enforces this (`app/lazy-wallet`). A startup `restore()` runs only behind the `zeno-wallet-connected` flag and never prompts.

## Layout

```
<repo root>
  package.json, tsconfig.json, vite.config.ts, vitest.config.ts, vitest.setup.ts,
  eslint.config.js, index.html, public/, docs/
  src/
    App.vue, main.ts, nav.ts, router.ts, style.css
    config.ts, types/index.ts
    core/            services and composables (index.ts and composables/index.ts are barrels)
    components/      components (index.ts is the barrel of the shared components)
    pages/
  test/              helpers, replay client, RPC fixtures
```

Import rules:

1. Import write modules (wallet, settlement writes, deploy, withdrawal, admin, local runner, and their composables and components) by their path, never through the `@/core` barrel. Rollup keeps a barrel's module-level `ref()` calls, so a barrel re-export pulls write code into every page that imports `@/core`. The barrels hold the read modules only.
2. Modules under `src/core/` import their siblings by relative path and constants from `@/config`. No module under `src/core/` imports the `@/core` barrel.

## Commands

```bash
npm install
npm run dev                # the app on :5173
npm run build              # typecheck, then vite build
npm run typecheck          # vue-tsc
npm run lint               # ESLint (TypeScript + Vue)
npm test                   # Vitest
npm run format             # Prettier
```

Run `npm run typecheck`, `npm run lint` and `npm test` after every change.

## Git dependencies

`znn-typescript-sdk`, `zeno-client` and `nom-ui` are not published to npm, so `package.json` installs each from a pinned GitHub commit: `digitalSloth/znn-typescript-sdk`, `Zeno-L2/zeno-client-ts` and `digitalSloth/nom-ui`. `npm install` runs the `prepare` scripts of `znn-typescript-sdk` and `zeno-client`, which build their `dist/`. `nom-ui` ships its Vue source, which this app's build compiles, and its dependencies, including Vue, install once beside the app's own.

To move a dependency to another commit, change the commit in `package.json` and run `npm install`. To try an unpushed change in a sibling checkout, run `npm install ../zeno-client-ts` (or the other checkout's path), and restore the pinned spec before committing.

Gotcha: run a single test file with `npx vitest run <file>` from the repo root.

## Conventions

- No semicolons, single quotes, 100 columns (Prettier). Named exports.
- Vite config sets the polyfill plugin's `globals` to false. `main.ts` sets `Buffer`, `global` and `process` instead, because the linked packages cannot resolve the plugin's shims.
- Tests use Vitest with happy-dom. `vitest.setup.ts` at the root supplies an in-memory `localStorage`.
- Branches are `feature/<short-description>`. Commits are `feat|fix|chore|docs|test: lower case sentence` plus a body. Never commit to `main`.
