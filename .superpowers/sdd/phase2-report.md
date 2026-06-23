# Phase 2: Biome lint/format and Husky pre-commit hook

## biome.json settings

- Schema: `https://biomejs.dev/schemas/2.5.1/schema.json` (matches installed `@biomejs/biome@2.5.1`)
- VCS: `enabled: true`, `clientKind: "git"`, `useIgnoreFile: true`
- Formatter: 2-space indent, line width 100, LF line endings
- JavaScript: single quotes, semicolons always, `es5` trailing commas, arrow parentheses always, bracket spacing, `quoteProperties: asNeeded`
- JSON formatter: 2-space indent
- Linter preset: `recommended`
- Style rules: `noNonNullAssertion`, `useConst`, `useDefaultParameterLast`, `useTemplate` (warn), `noParameterAssign`, `useExponentiationOperator`
- Suspicious rules: `noExplicitAny` (warn), `noArrayIndexKey` (warn), `noDoubleEquals`, `noDebugger`, `noConsole: off`
- Correctness rules: `noUnusedVariables`, `noUnusedImports`, `useExhaustiveDependencies` (warn), `noUndeclaredVariables`, `noUnreachable`
- Complexity rules: `noExcessiveCognitiveComplexity` (warn), `noUselessConstructor`, `useLiteralKeys`
- Performance rules: `noAccumulatingSpread` (warn), `noDelete` (warn)
- Security rules: `noDangerouslySetInnerHtml`
- Nursery rules: `noFloatingPromises`, `noMisusedPromises`

All settings mirror `signalk-virtual-weather-sensors/biome.json` exactly.

## Files reformatted by biome

13 files auto-fixed by `biome check --write .` (formatting and safe lint fixes).

## Lint findings fixed in code

### `src/damping.ts` -- `noNonNullAssertion` (error)

Two non-null assertions (`state.pending!.ts`, `state.pending!.count`) on line 37 were eliminated by replacing the truthy guard with an explicit `!== undefined` check and repeating it in the ternary condition. This avoids both the lint violation and any ambiguity about the control-flow guarantee.

### `src/combine.ts` -- `noExcessiveCognitiveComplexity` (warn, complexity 17)

Extracted `computeValue()` to handle the `angular` / `position` / `scalar` branches. The `combine()` function retains early-exit guards and the disagree-spread check; `computeValue()` owns the per-kind value computation. Both helpers are below the 15-point threshold.

### `src/config.ts` -- `noExcessiveCognitiveComplexity` (warn, complexity 44)

Refactored the single `validateConfig` loop body into two helpers:
- `validateScalars()` validates method, angular mode, trimFraction, and timing/source-count fields; returns a discriminated union (`{ scalars }` or `{ error }`).
- `validatePathEntry()` calls `validateScalars()`, then validates optional positive fields and jumpRejection, then builds the resolved `PathConfig`.

`validateConfig()` now owns only the deduplication loop and `maxSourcesPerPath` fallback.

### `src/index.ts` -- `noExcessiveCognitiveComplexity` (warn, complexity 30)

Extracted `observeValue()` from `observe()` to handle the per-value branch logic (category check, classification guard, registry update, maybeEmit). The outer `observe()` function retains only context filtering and the update/values iteration.

## Rules configured (none)

No rules were disabled or narrowed in `biome.json`. All findings were resolved by fixing the code.

## Verification

```
npm run lint       exit 0  -- no errors, no warnings
npm run type-check exit 0  -- clean
npm test           exit 0  -- 122/122 tests pass (14 test files)
npm run build      exit 0  -- dist/index.js 19.0 KB emitted cleanly
```
