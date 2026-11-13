## Architecture and why

A folder of Playwright tests beside the apps: browser tests and tests through the real API. Every test file has one
place, so suites stay findable as they grow. Denials end with "(e2e layout)".

```text
package.json, playwright.config.ts, tsconfig.json, README.md
tests/
  <name>.spec.ts, <name>.setup.ts   the only files directly in tests/
  <suite>/              one folder per suite (checkout/, access-api/)
    <name>.spec.ts, <name>.po.ts
    <area>/<area>/      at most two levels of area folders
```

- Names are kebab-case, with one optional role before the extension (`account.po.ts`). Data a test reads, such as an
  image to upload, keeps its own extension.
- Folders are named after what they test or hold (`checkout/`, `page-objects/`); `utils`, `helpers` and the like are
  denied.
- `*.spec.ts` and `*.setup.ts` files may use non-null assertions; helpers may not. Lint-disable and `@ts-` comments
  are reported: fix the code they would silence.
- The type check needs this folder's own `tsconfig.json`. The tests run in the gates only when the workspace names a
  `test` package script in `harness.config.ts`.

## Where code goes

- Need a test → put it in `tests/<suite>/<name>.spec.ts`; a suite-wide setup goes in `<name>.setup.ts`.
- Need a page object or helper → put it in the suite folder, or in an area folder inside it, never directly in
  `tests/`.
- Need a test of application code → it belongs beside that code as `<name>.test.ts`, not here and not in `tooling/`.
