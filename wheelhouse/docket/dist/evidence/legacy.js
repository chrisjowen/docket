/** Used only if neither the ontology nor the built-in one says what an unevidenced resource is worth. */
const UNEVIDENCED = 0.5;
/** Gives `sources:` or `trust:`: the ontology says how it is trusted in the current form. */
export const usesTrustSettings = (ontology) => ontology.sources !== undefined || ontology.trust !== undefined;
/** Gives a legacy `evidence:` block or a type's or relationship's `confidence:` rules. */
export const hasLegacyTrust = (ontology) => ontology.evidence !== undefined ||
    Object.values(ontology.resourceTypes).some((definition) => definition.confidence !== undefined) ||
    Object.values(ontology.relationships).some((definition) => definition.confidence !== undefined);
/** A legacy source kind as a source type: its required location fields become its locator. */
export const legacySourceType = (definition) => {
    const locator = {};
    for (const field of definition.requires ?? [])
        locator[field] = { required: true };
    for (const field of definition.requiresAny ?? [])
        locator[field] ??= {};
    return {
        ...(definition.description !== undefined ? { description: definition.description } : {}),
        ...(Object.keys(locator).length > 0 ? { locator } : {}),
        ...(definition.requiresAny?.length ? { requiresAny: [...definition.requiresAny] } : {})
    };
};
const basePolicy = (source, score) => ({
    name: `${source} evidence`,
    when: { source },
    score
});
const aboutPolicies = (about, rules) => Object.entries(rules).map(([source, score]) => ({
    name: `${source} evidence of ${about}`,
    when: { about, source },
    score
}));
/**
 * The rules a legacy type or relationship without its own `confidence:` took
 * from docket's built-in ontology: those the built-in gives the same name,
 * for sources the ontology registers - evidence from any other source fails
 * validation, so a rule for it never priced anything.
 */
const inherited = (about, defaults, sources) => (defaults?.trust?.policies ?? []).filter((policy) => policy.when.about === about && policy.when.source in sources);
/**
 * Reads legacy evidence settings as sources and policies that score exactly
 * as they did:
 *
 * - each `evidence.sources.<name>` is a source type, its `requires` and
 *   `requiresAny` fields its locator, and its `confidence` a base policy
 * - each type's and relationship's `confidence: {<source>: v}` is a policy
 *   about that type or relationship
 * - without `evidence.sources`, docket's built-in sources and their policies
 *   are written out in full, as are the built-in rules a type or relationship
 *   of the same name inherited for a registered source - so what was
 *   implicit can be seen and deleted
 * - an observation of an unregistered source is worth `unevidenced`, and
 *   nothing is capped, as before
 *
 * `defaults` is docket's built-in ontology, already in the current form.
 */
export const convertLegacyTrust = (ontology, defaults) => {
    const own = ontology.evidence?.sources;
    const sources = own
        ? Object.fromEntries(Object.entries(own).map(([name, definition]) => [name, legacySourceType(definition)]))
        : structuredClone(defaults?.sources ?? {});
    const base = own
        ? Object.entries(own).map(([name, definition]) => basePolicy(name, definition.confidence))
        : (defaults?.trust?.policies ?? []).filter((policy) => policy.when.about === undefined);
    const policies = [...structuredClone(base)];
    for (const [name, definition] of Object.entries(ontology.resourceTypes)) {
        policies.push(...(definition.confidence
            ? aboutPolicies(name, definition.confidence)
            : defaults?.resourceTypes[name]
                ? structuredClone(inherited(name, defaults, sources))
                : []));
    }
    for (const [name, definition] of Object.entries(ontology.relationships)) {
        policies.push(...(definition.confidence
            ? aboutPolicies(name, definition.confidence)
            : defaults?.relationships[name]
                ? structuredClone(inherited(name, defaults, sources))
                : []));
    }
    const unevidenced = ontology.evidence?.unevidenced ?? defaults?.trust?.unevidenced ?? UNEVIDENCED;
    return {
        sources,
        trust: { unevidenced, fallback: unevidenced, cap: 1, policies }
    };
};
/**
 * The ontology with its trust in the current form: legacy settings converted
 * and dropped, so nothing downstream reads both. An ontology that already
 * gives `sources:` or `trust:` keeps them, and any legacy settings beside them
 * are dropped unread.
 */
export const withTrustSettings = (ontology, defaults) => {
    const current = usesTrustSettings(ontology);
    const section = current
        ? { sources: ontology.sources ?? {}, trust: ontology.trust ?? {} }
        : convertLegacyTrust(ontology, defaults);
    const strip = (definitions) => Object.fromEntries(Object.entries(definitions).map(([name, { confidence: _legacy, ...definition }]) => [name, definition]));
    const { evidence: _legacy, ...rest } = ontology;
    return {
        ...rest,
        resourceTypes: strip(ontology.resourceTypes),
        relationships: strip(ontology.relationships),
        sources: section.sources,
        trust: section.trust
    };
};
