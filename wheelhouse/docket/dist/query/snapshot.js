import { DEFAULT_SCOPE } from '../adapters/docket.js';
import { validate } from '../commands/validate.js';
import { canonicalState } from '../sync/inputs.js';
const key = (kind, id) => `${kind}\u0000${id}`;
/** A snapshot of what `validate` read. */
export const snapshotOf = (read, scope = DEFAULT_SCOPE) => {
    const state = canonicalState(read.entities, read.documents, scope);
    const records = new Map(state.inputs.map((derived) => [key(derived.input.kind, derived.input.id), derived]));
    const entities = new Map(read.entities.map((entity) => [entity.id, entity]));
    return {
        resolved: read.resolved,
        scope,
        entities: read.entities,
        documents: read.documents,
        broken: read.broken,
        diagnostics: read.diagnostics,
        state,
        record: (kind, id) => records.get(key(kind, id)),
        entity: (id) => entities.get(id),
        reader: {
            get: async (kind, id) => records.get(key(kind, id))?.input,
            list: async (kind) => state.inputs.filter(({ input }) => input.kind === kind).map(({ input }) => input)
        }
    };
};
/** Reads the canonical files under the project `.docket.yaml` at or above `cwd` is in. */
export const takeSnapshot = async (cwd) => snapshotOf(await validate({ cwd }));
