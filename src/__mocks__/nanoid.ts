/**
 * Jest manual mock for the `nanoid` package.
 *
 * `nanoid` ships as ESM-only (package.json "type": "module"), which Jest's
 * default CommonJS transform (ts-jest, matching `^.+\.(t|j)s$`) cannot parse
 * — any spec file that imports something depending on `nanoid` (currently
 * auth.service.ts and orders.service.ts, and transitively the whole
 * AppModule) fails with "Cannot use import statement outside a module"
 * before a single test runs. Wired up via `moduleNameMapper` in
 * package.json's `jest` config and test/jest-e2e.json.
 *
 * This reimplements just the `customAlphabet` API surface actually used in
 * this codebase — a function that, given an alphabet, returns a generator of
 * random strings of a given length. Not cryptographically significant for
 * tests, only needs to produce syntactically valid ids.
 */
export function customAlphabet(alphabet: string, defaultSize = 21) {
  return (size: number = defaultSize): string => {
    let id = '';
    for (let i = 0; i < size; i++) {
      id += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return id;
  };
}

export function nanoid(size = 21): string {
  return customAlphabet(
    'ModuleSymbhasOwnPr0123456789ABCDEFGHNRVfgctiUvz_-',
    size,
  )();
}
