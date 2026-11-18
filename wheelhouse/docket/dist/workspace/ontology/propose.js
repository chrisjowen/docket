import { isMap, parseDocument, stringify } from '../../vendor/yaml.js';
import { OntologyInvalid } from './errors.js';
import { sizeProblem } from './yaml-io.js';
const isPlain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/**
 * A JSON merge patch (RFC 7396) applied to YAML values: a mapping merges key
 * by key, `null` removes a key, anything else replaces what was there.
 */
export function mergePatch(target, patch) {
    if (!isPlain(patch))
        return patch;
    const out = isPlain(target) ? { ...target } : {};
    for (const [key, value] of Object.entries(patch)) {
        if (value === null)
            delete out[key];
        else
            out[key] = mergePatch(out[key], value);
    }
    return out;
}
/**
 * The text a proposal makes: a whole ontology as given, or the head with the
 * patch merged into it. A patch keeps the head's comments where it does not
 * touch them. Throws `OntologyInvalid` for a patch that is not a YAML mapping.
 */
export function proposedText(head, proposal) {
    if ('yaml' in proposal)
        return proposal.yaml;
    const tooLarge = sizeProblem(proposal.patch);
    if (tooLarge)
        throw new OntologyInvalid([tooLarge]);
    const patchDoc = parseDocument(proposal.patch);
    if (patchDoc.errors.length || !isMap(patchDoc.contents)) {
        throw new OntologyInvalid([
            { severity: 'error', code: 'invalid-patch', message: `The patch is not a YAML mapping${patchDoc.errors[0] ? `: ${patchDoc.errors[0].message}` : ''}.` }
        ]);
    }
    const patch = patchDoc.toJS();
    if (head === null)
        return stringify(mergePatch({}, patch), { lineWidth: 0 });
    const doc = parseDocument(head);
    const apply = (path, value) => {
        if (value === null) {
            doc.deleteIn(path);
            return;
        }
        const current = doc.getIn(path);
        if (isPlain(value) && isMap(doc.getIn(path, true)) && current !== undefined) {
            for (const [key, inner] of Object.entries(value))
                apply([...path, key], inner);
            return;
        }
        doc.setIn(path, doc.createNode(isPlain(value) ? mergePatch(isPlain(current) ? current : undefined, value) : value));
    };
    for (const [key, value] of Object.entries(patch))
        apply([key], value);
    return doc.toString({ lineWidth: 0 });
}
