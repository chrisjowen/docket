import { entityProjectionDefinition, packageVersion, parseAdapterConfig } from '../../adapter-kit/dist/index.js';
import { mem0ConfigSchema } from './config.js';
import { createMem0Projection } from './mem0-projection.js';
export { mem0ConfigSchema } from './config.js';
export { createMem0Projection } from './mem0-projection.js';
/**
 * The mem0 adapter: one verbatim memory per entity, on hosted mem0, its
 * self-hosted server or `mem0ai/oss`. `mem0ai` is loaded when an instance
 * connects, so importing this module needs no SDK.
 */
const definition = entityProjectionDefinition({
    name: 'mem0',
    version: packageVersion(new URL('../package.json', import.meta.url)),
    // mem0 extracts memories with a model: rebuilt, but not byte for byte.
    rebuild: 'reconstructible',
    validateConfig: (input) => parseAdapterConfig(mem0ConfigSchema, input),
    createProjection: (config) => createMem0Projection(config)
});
export default definition;
