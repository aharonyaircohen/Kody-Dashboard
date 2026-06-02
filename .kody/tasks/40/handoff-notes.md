## What

Fixed a TypeScript compilation error in `tests/int/close-pr-action.int.spec.ts` that was causing the E2E CI workflow to fail.

## How

The `vi.mock` factory for `@dashboard/lib/github-client` used the pattern `(...a: unknown[]) => fn(...a)` to wrap the mock functions. TypeScript rejected this with error TS2556: "A spread argument must either have a tuple type or be passed to a rest parameter." — because `unknown[]` is not a valid rest parameter type.

The fix is `(...a: Parameters<typeof fn>) => fn(...a)`, which resolves to the actual function's parameter tuple type, satisfying TypeScript's rest-parameter rules. Prettier re-formatted the file as part of the same fix.

## Why

The IIFE wrapper is required because `vi.mock` is hoisted to the top of the file, but the mock functions (`closePR`, `deleteBranch`, etc.) are defined at module scope below the mock call — the wrapper defers the reference until runtime. The type needed to be corrected to satisfy the TypeScript compiler.
