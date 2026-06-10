// Vitest stub for the `server-only` package. The real module throws when
// imported outside a React Server Component build; under vitest we alias it
// here to a harmless empty module so server-only utilities remain
// unit-testable. See vitest.config.ts `resolve.alias`.
export {};
