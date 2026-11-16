# Coverage spike findings

Run `node spike/spike.mjs dev` and `node spike/spike.mjs preview` from any directory. Ports default to 5187 and 4187, with an optional third argument to override. Preview builds the example with `--sourcemap`. The script always stops the app it starts, and writes raw coverage, path traces, function/branch inspection data, Istanbul JSON, and HTML under the example's `.frontcover/spike-<mode>/`.

Verified on 2026-11-15 using Node 26.13.1, Playwright 1.65.1, Chromium revision 1255 (159.0.8154.6), Vite 8.3.8, and Monocart 3.2.1:

- Both modes produce the original `src/App.tsx`, `src/components/TodoItem.tsx`, `src/lib/filters.ts`, `src/lib/storage.ts`, and `src/main.tsx` paths. The unvisited Settings chunk is absent, so it must be discovered on disk.
- Vite dev's inline maps use basenames such as `App.tsx`. Combining those with the generated module's directory resolves the real source path. Preview's external maps use paths such as `../../src/App.tsx`. Match these against actual source paths, never an ambiguous basename.
- Dev's Istanbul function names are useful. Preview's bundle names are minified; original declaration locations remain usable, so frontcover derives names from source text.
- The empty-title validation path has a zero count in both modes. Dev has an `IfStatement` arm; preview has a mapped `ConditionalExpression` arm. Arm ranges remain useful, but production boundaries can be less exact.
- Native V8 range analysis was not needed for the tested validation paths. Istanbul does not model every catch block as a branch.
- `@playwright/test/cli` resolves publicly. The installed browser revision launches without requiring a new browser download.
- `npm ls @playwright/test` shows one deduplicated 1.65.1 copy with the workspace `file:../..` dependency.
- `npm run test:package` packs and installs the actual tarball, checks the executable, and runs tests in ESM and CommonJS consumer projects. The consumer and frontcover resolve the same physical Playwright installation. CommonJS projects use `frontcover.config.mjs` and a TypeScript Playwright config.
- `npm test` passes 26 tests; `npm run typecheck` passes. The temporary delete spec closes `deleteTodo` and its button callback: +2 reached lines and 2 closed gaps. Final example artifacts are restored to the add-only dev run with 24 gaps.
- Real Chromium tests exercise fixture/report generation, source-map capture, gap closure, popup and second-page collection, and unexpected-failure exclusion. Codegen was launched and cancellation cleanup was verified. Interactive recording could not be completed because the computer-use host was unavailable; recorder lifecycle and post-processing are covered by a controlled CLI stub.
- `frontcover report` successfully invokes the system HTML opener, and referenced report assets exist. Visual report rendering was not inspected because computer access was unavailable. Minimum-version Node 22.18 and other operating systems were not tested in this session.

The initial example app's port 5173 was occupied by another app. Verification used dedicated ports without stopping that server.
