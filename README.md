# frontcover

Record a Playwright test, run it with browser coverage, then see which paths to record next. Tests are plain Playwright files that you own. Coverage stays local; no instrumentation or AI service is required.

frontcover collects Chromium's V8 coverage and uses [Monocart](https://github.com/cenfun/monocart-coverage-reports) to map it to original source files, write Istanbul `coverage-final.json`, and generate an HTML report. It measures browser code, including lazy chunks, rather than server components or API routes.

## Try the example

Requires Node **22.18+** and Chromium for the installed Playwright version.

```sh
npm install                         # also builds frontcover with tsc
npx playwright install chromium
cd examples/todo-app
npm run frontcover -- run
npm run frontcover -- gaps
npm run frontcover -- report
```

The demo stores todos in localStorage. Each Playwright test gets a fresh browser context. Its only checked-in test adds a todo. The gaps include:

- `src/pages/Settings.tsx`: a lazy file that was never loaded.
- `deleteTodo`, `renameTodo`, and `toggleTodo`: handlers never called.
- The empty-title and duplicate-title validation paths in `addTodo`.

If port 5173 is busy, prefix example commands with `FRONTCOVER_EXAMPLE_PORT=5187`. For production coverage, run `npm run build` in the example, then use `FRONTCOVER_EXAMPLE_MODE=preview` with the same commands. Its build enables source maps.

## Add it to an app

While developing this unpublished package, build it and install the local folder in your app:

```sh
npm install -D /path/to/frontcover @playwright/test
npx playwright install chromium
npx frontcover init
```

`init` checks Playwright is resolvable, creates absent configs, and adds `.frontcover/` to `.gitignore`. It prints setup snippets for existing configs, preserving their contents.

```ts
// frontcover.config.ts (ESM project)
import { defineConfig } from 'frontcover';

export default defineConfig({
  app: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    // reset: 'npm run db:seed',
    // timeout: 60_000,
  },
  include: ['src/**/*.{ts,tsx,js,jsx,vue,svelte}'],
  exclude: ['**/node_modules/**', '**/*.test.*', '**/*.spec.*', '**/*.d.ts'],
  testDir: 'e2e',
  outputDir: '.frontcover',
  // storageState: 'e2e/.auth/user.json',
});
```

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
import { withFrontcover } from 'frontcover/playwright';
import frontcover from './frontcover.config';

export default defineConfig(withFrontcover(frontcover, {
  // Your normal Playwright options, projects, retries, and reporters.
  use: { headless: true },
}));
```

The wrapper supplies `testDir`, `webServer` (when `app.command` exists), `use.baseURL`, and optional `storageState`, unless your Playwright config overrides them. It preserves existing reporters and appends frontcover's reporter by absolute path. The app server is reusable outside CI (`reuseExistingServer: !CI`). The CLI and Playwright settings should point to the same URL, test directory, and storage state.

Use the extended test fixture in every test you want counted:

```ts
import { test, expect } from 'frontcover';

test('add a todo', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('New todo').fill('Buy milk');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByRole('listitem')).toContainText('Buy milk');
});
```

In a **CommonJS project**, `init` writes `frontcover.config.mjs` with the same JavaScript config and imports it from `playwright.config.ts`. The package itself is ESM-only; a CommonJS Playwright config can load the installed package on supported Node versions. The CLI uses native Node imports, so `.ts` configs need an ESM package and erasable TypeScript syntax. Supported config names are `frontcover.config.ts`, `.js`, and `.mjs`.

## The recording loop

```sh
npx frontcover run
npx frontcover gaps --top 10
npx frontcover gaps <gap-id>
npx frontcover record empty-title --gap <gap-id> --url /
```

`record` displays the target gap, runs `app.reset`, reuses a reachable app or starts `app.command`, and opens the user's own [Playwright codegen](https://playwright.dev/docs/codegen). Interact with the app and close the recording browser when finished.

The recording is staged before replacing a spec. frontcover rewrites its import to `frontcover`, sets the test title, converts same-origin `page.goto` URLs to relative paths, and saves `e2e/empty-title.spec.ts`. It then resets the app again and runs only that test with `FRONTCOVER_KEEP=1`, merging its coverage with the last run. The reporter prints lines reached and gaps closed. Any app server started by frontcover is stopped afterward; an existing server stays running.

For the demo, click **Add** with an empty input and add an assertion for the validation message in codegen (or edit the generated test afterward). The next gap report should close the empty-title branch. Record a delete interaction next to close `deleteTodo`.

```sh
npx frontcover record delete-todo
npx frontcover run                 # fresh coverage from all tests
npx frontcover gaps --md
```

Use `--force` to replace an existing spec. Names accept letters, digits, underscores, and hyphens. Use `storageState` for login state; recording supports both a JSON filename and an inline Playwright storage-state object. `app.reset` is a shell command run in the config directory. It is responsible for backend state; Playwright's fresh context handles browser storage. Direct `npx playwright test` collects coverage but does **not** run `app.reset`.

## Commands

Run from the directory containing both configs. Relative paths and reported source paths are relative to that directory.

| Command | Behavior |
| --- | --- |
| `frontcover init` | Create setup files without overwriting existing ones. |
| `frontcover record <name> [--url /path] [--gap <id>] [--force]` | Record, save, reset, replay, and show the coverage delta. |
| `frontcover run [Playwright arguments]` | Reset and run Playwright, forwarding its exit code. |
| `frontcover gaps [--top N] [--file glob]` | Show ranked gaps. Quote globs in the shell. |
| `frontcover gaps --json` / `--md` | Machine-readable JSON or a Markdown table. |
| `frontcover gaps <id>` | Show one gap and its source snippet. |
| `frontcover report` | Open the generated HTML report in the default browser. |

For example: `frontcover run --project chromium --grep 'checkout'`, or `frontcover gaps --file 'src/pages/**' --top 5`.

**Playwright's command-line `--reporter` replaces configured reporters.** If you pass it, frontcover's reporter will not run. Configure extra reporters through `withFrontcover` instead.

## Output and gap rules

The default `.frontcover/` directory sits next to `playwright.config`:

| Artifact | Contents |
| --- | --- |
| `raw/*.json` | V8 entries per successful test attempt, with external source maps captured while the app is running. |
| `coverage-final.json` | Istanbul coverage using original source paths. |
| `index.html`, `assets/`, `coverage-data.js` | Monocart's browser coverage report. |
| `lcov.info` | LCOV coverage for other tools. |
| `gaps.json`, `gaps.md` | Ranked uncovered paths. JSON is an array of `Gap` objects. |
| `diff.json` | `closed`, `new`, and `remaining` gap arrays compared with the previous run. |
| `summary.json` | Reached statement-start lines and loaded-code statement counts. |

A gap contains `id`, `kind`, `file`, optional `name` / `inside`, `loc` (one-based lines, zero-based columns), `lines`, `snippet`, and `score`.

- A **file** gap matches `include` but never appears in coverage. Files are found on disk; type-only declarations are skipped with a conservative heuristic.
- A **function** gap is a mapped function with a zero call count. Source declarations recover names even from minified bundles; assignments, JSX attributes, and object properties help name anonymous callbacks.
- A **branch** gap is a zero-count mapped arm inside a called function. Implicit else arms with no source location are skipped.
- Nested gaps fold into their outermost uncovered path. Ranking uses line span, then file > function > branch.
- IDs hash file, kind, first source line, and a duplicate ordinal. They survive unrelated line insertions; editing that first line changes the ID. Compare runs using the same build mode because minification can change mapped branch boundaries.

`run` clears previous raw recordings. `FRONTCOVER_KEEP=1` retains them for incremental recording; run the full suite after source changes to refresh the evidence. Failed unexpected attempts and skipped tests are excluded. Expected failures (`test.fail`) are included if their actual status matches. A run with no browser coverage preserves previous reports and gaps rather than claiming paths were closed.

## Limits

Coverage requires **Chromium** and usable source maps for transformed code. Firefox/WebKit tests still run, but contribute no coverage. Development and production branch shapes can differ, and source-map precision limits the locations available in a minified build. Istanbul's branch model does not expose every possible uncovered statement or catch block as a separate gap.

The fixture observes pages, popups, and additional pages in Playwright's built-in `context`. Explicit `page.close()` collects coverage before closing. A page that closes itself, or a context closed manually before teardown, can lose its V8 data; the fixture warns. Separately created browser contexts are not observed. Concurrent shards should use separate output directories; cross-shard aggregation is not implemented.

No server coverage, HAR replay, AI gap hints, or test pruning is included in v1. Raw coverage and reports contain your app's source, so keep `.frontcover/` out of version control.

## Development and verification

```sh
npm install
npm run typecheck
npm test                         # analyzer, IDs, diff, type-only files, config, recorder/CLI
npm run test:e2e                  # real Chromium; includes one intentional failing test
npm run test:package              # tarball install, executable, ESM/CommonJS consumers
node spike/spike.mjs dev
node spike/spike.mjs preview      # builds with source maps first
```

The E2E check verifies known gaps from the add-only example, records a temporary delete spec and confirms its gap closes, checks popup/second-page coverage, and proves unexpected failures are excluded. Temporary specs are removed. The delete delta is saved in `.frontcover/verification/delete-diff.json`. The recorder/CLI unit tests use a controlled codegen stub; they do not substitute for an interactive codegen smoke test.

See [spike/README.md](spike/README.md) for source-map findings and the verification limits of this development session.

MIT licensed.
