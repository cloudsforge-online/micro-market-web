/**
 * One React, for the duration of the test run.
 *
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NEEDED, AND WHY THE APPLICATION DOES NOT NEED IT
 *
 * `@cloudsforge/ui` is consumed as `link:../ui/packages/ui`, which symlinks the design system's
 * WORKING TREE — that is the whole point of `link:` over `file:`, and package.json says so. The
 * working tree has its own `node_modules`, containing its own `react` and `react-dom` (they are
 * peer dependencies there, and devDependencies so that its own suite can run).
 *
 * Node resolves a bare specifier from the REALPATH of the importing file, so
 * `ui/packages/ui/src/index.tsx`'s `import { useState } from 'react'` finds the design system's
 * copy while this repository's pages find this repository's. Two React instances share no
 * dispatcher, and the first hook the shared chrome calls throws
 * `TypeError: Cannot read properties of null (reading 'useState')` — React's shape for "hooks
 * called outside a render", which is exactly what a second copy looks like from the inside.
 *
 * The BUILD is unaffected, which is why nothing has noticed: `@vitejs/plugin-react` sets
 * `resolve.dedupe: ['react', 'react-dom']`, so `pnpm build` and `pnpm dev` collapse the two by
 * construction. `tsc` does not care — types are structural. It is only the Node test loader that
 * has no deduplication of its own, so this file supplies vite's `dedupe` to it, and nothing else.
 *
 * ── Why a resolve hook rather than working around it ──────────────────────────────────────────
 *
 * The alternative was to keep the shared chrome out of the suite. That would mean no scenario
 * could render the thing every surface has in common — the bar, the product switcher, the account
 * menu — and doc 22's BJ-SITE-07, BJ-SITE-08 and BJ-A11Y-12 are all about exactly that chrome. A
 * suite that can only test the parts of a page this repository wrote is a suite that cannot see
 * the half of every page it did not.
 * ══════════════════════════════════════════════════════════════════════════════════════════════
 */
import module, { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

/** This repository's own copies. Every `react` and `react-dom` specifier resolves to these. */
const CANONICAL = new Map<string, string>()
for (const specifier of [
  'react',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  'react-dom',
  'react-dom/client',
]) {
  CANONICAL.set(specifier, pathToFileURL(require.resolve(specifier)).href)
}

const registerHooks = (module as unknown as { registerHooks?: unknown }).registerHooks
if (typeof registerHooks !== 'function') {
  // Loud rather than silent. Without the hook the suite does not fail with a wrong answer, it
  // fails with a confusing one — and a harness that quietly degrades is the thing this estate
  // keeps producing.
  throw new Error(
    'node:module.registerHooks is unavailable (Node ' +
      process.version +
      '). It landed in 22.15; package.json requires >=22. Without it the linked design system ' +
      'loads a second copy of React and every rendered scenario fails with "Cannot read ' +
      'properties of null (reading \'useState\')".',
  )
}

;(
  registerHooks as (hooks: {
    resolve: (
      specifier: string,
      context: unknown,
      next: (s: string, c: unknown) => { url: string },
    ) => { url: string; shortCircuit?: boolean }
  }) => void
)({
  resolve(specifier, context, next) {
    const canonical = CANONICAL.get(specifier)
    if (canonical) return { url: canonical, shortCircuit: true }
    return next(specifier, context)
  },
})
