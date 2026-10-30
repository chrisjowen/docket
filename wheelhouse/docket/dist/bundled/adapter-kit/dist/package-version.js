import { readFileSync } from 'node:fs';
/**
 * The `version` in the package.json at `url` - how an adapter reports its own
 * version, e.g. `packageVersion(new URL('../package.json', import.meta.url))`.
 */
export const packageVersion = (url) => JSON.parse(readFileSync(url, 'utf8')).version;
