import { readFileSync } from 'node:fs';
import { parse as parseYaml } from '../vendor/yaml.js';
import { DEFAULT_ONTOLOGY_PATH } from '../config/defaults.js';
import { ontologySchema } from '../model/index.js';
/** Used only if neither the repository's ontology nor the built-in one sets `evidence.unevidenced`. */
const UNEVIDENCED = 0.5;
let builtin;
/**
 * The ontology `docket init` writes. Its evidence sources and confidence rules
 * are the defaults for a repository whose own ontology predates them or leaves
 * them out.
 */
export const builtinOntology = () => {
    builtin ??= ontologySchema.parse(parseYaml(readFileSync(DEFAULT_ONTOLOGY_PATH, 'utf8')));
    return builtin;
};
const rulesFor = (own, fallback) => Object.fromEntries(Object.entries(own).map(([name, definition]) => [
    name,
    definition.confidence ?? fallback[name]?.confidence ?? {}
]));
/**
 * The repository's own rules, falling back to the built-in ones: its
 * `evidence.sources` replace the built-in source kinds whole, and a type or
 * relationship without a `confidence:` block takes the built-in rule for that
 * name, if there is one.
 */
export const confidenceModel = (ontology, defaults = builtinOntology()) => ({
    sources: ontology.evidence?.sources ?? defaults.evidence?.sources ?? {},
    unevidenced: ontology.evidence?.unevidenced ?? defaults.evidence?.unevidenced ?? UNEVIDENCED,
    resourceTypes: rulesFor(ontology.resourceTypes, defaults.resourceTypes),
    relationships: rulesFor(ontology.relationships, defaults.relationships)
});
/** What one observation from `source` is worth for `subject`. */
export const observationConfidence = (model, subject, source) => {
    const rules = subject.kind === 'resource'
        ? model.resourceTypes[subject.type]
        : model.relationships[subject.rel];
    return rules?.[source] ?? model.sources[source]?.confidence ?? model.unevidenced;
};
/** Two decimal places: finer than that is noise, and it keeps projections readable. */
const round = (value) => Math.round(value * 100) / 100;
/**
 * Combines independent evidence. Observations of one source kind share its
 * failure mode - a second file naming the same secret is not a second
 * opinion - so within a kind only the strongest counts. Across kinds they are
 * treated as independent: `1 - Π(1 - c)`.
 *
 * With no evidence at all, a stated confidence (a file's
 * `provenance.confidence`) is taken as given, and otherwise the ontology's
 * `unevidenced` default.
 */
export const assess = (model, subject, evidence, stated) => {
    if (evidence.length === 0) {
        return stated === undefined
            ? { confidence: model.unevidenced, basis: 'unevidenced', evidenceCount: 0, sources: [] }
            : { confidence: stated, basis: 'stated', evidenceCount: 0, sources: [] };
    }
    const strongest = new Map();
    for (const observation of evidence) {
        const value = observationConfidence(model, subject, observation.source);
        strongest.set(observation.source, Math.max(strongest.get(observation.source) ?? 0, value));
    }
    let doubt = 1;
    for (const value of strongest.values())
        doubt *= 1 - value;
    return {
        confidence: round(1 - doubt),
        basis: 'evidence',
        evidenceCount: evidence.length,
        sources: [...strongest.keys()].sort()
    };
};
