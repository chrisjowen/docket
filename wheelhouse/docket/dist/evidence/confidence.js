import { readFileSync } from 'node:fs';
import { parse as parseYaml } from '../vendor/yaml.js';
import { DEFAULT_ONTOLOGY_PATH } from '../config/defaults.js';
import { EVIDENCE_LOCATION_FIELDS, ontologySchema } from '../model/index.js';
import { directoryAttributes, findPerson } from '../people/directory.js';
import { usesTrustSettings, withTrustSettings } from './legacy.js';
/** What an ontology in the current form gets for each threshold it leaves out. */
export const TRUST_DEFAULTS = {
    unevidenced: 0.5,
    fallback: 0.4,
    cap: 0.99,
    accept: { default: 0.75, decision: 0.8 },
    bands: { established: 0.8, probable: 0.5 }
};
const NO_REGISTRY = { attributes: () => undefined };
/** The people directory as a registry for the ontology's identity sources: person instances and their directory attributes. */
export const peopleRegistry = (directory, sources) => ({
    attributes: (source, instance) => {
        const definition = sources[source];
        return definition?.kind === 'identity' ? directoryAttributes(directory, definition, instance) : undefined;
    },
    instance: (source, name) => (sources[source]?.kind === 'identity' ? findPerson(directory, name) : undefined)
});
let builtin;
/**
 * The ontology `docket init` writes, in the current form. Its sources and
 * policies are what an ontology that says nothing about trust is read with.
 */
export const builtinOntology = () => {
    builtin ??= withTrustSettings(ontologySchema.parse(parseYaml(readFileSync(DEFAULT_ONTOLOGY_PATH, 'utf8'))));
    return builtin;
};
/**
 * The ontology's sources, policies and thresholds. Legacy evidence settings
 * are converted first (`withTrustSettings`), so they score as they always
 * did; an ontology in the current form takes nothing from docket's built-in
 * one.
 */
export const confidenceModel = (ontology, options = {}) => {
    const current = usesTrustSettings(ontology) ? ontology : withTrustSettings(ontology, options.defaults ?? builtinOntology());
    const trust = current.trust ?? {};
    const sources = current.sources ?? {};
    return {
        sources,
        policies: trust.policies ?? [],
        unevidenced: trust.unevidenced ?? TRUST_DEFAULTS.unevidenced,
        fallback: trust.fallback ?? TRUST_DEFAULTS.fallback,
        cap: trust.cap ?? TRUST_DEFAULTS.cap,
        accept: { ...TRUST_DEFAULTS.accept, ...trust.accept },
        bands: { ...TRUST_DEFAULTS.bands, ...trust.bands },
        registry: options.registry ?? (options.people ? peopleRegistry(options.people, sources) : NO_REGISTRY)
    };
};
/**
 * The ontology's person source: the identity source named `person`, else its
 * first identity source. Evidence that cites no source is from this one - the
 * person the writer acts for - and legacy `human` evidence is written as it.
 * Undefined for an ontology with none, such as a legacy one.
 */
export const personSource = (ontology) => {
    const identities = Object.entries(ontology.sources ?? {}).filter(([, definition]) => definition.kind === 'identity');
    return (identities.find(([name]) => name === 'person') ?? identities[0])?.[0];
};
/** The fields an observation points with: the legacy top-level ones and its `locator` map. */
export const locatorOf = (observation) => {
    const out = {};
    for (const field of EVIDENCE_LOCATION_FIELDS) {
        const value = observation[field];
        if (value !== undefined)
            out[field] = value;
    }
    return { ...out, ...observation.locator };
};
const instanceOf = (observation, definition, locator) => {
    if (observation.sourceRef !== undefined)
        return observation.sourceRef;
    const fields = definition?.identifiedBy ?? [];
    if (fields.length === 0)
        return undefined;
    const values = fields.map((field) => locator[field]);
    if (values.some((value) => value === undefined))
        return undefined;
    return values.map((value) => (Array.isArray(value) ? value.join(',') : value)).join('/');
};
/**
 * Which source an observation is from, which instance of it, and what is
 * known about that instance. Attested values win over claims, and a claim
 * only counts for an attribute the source type marks `setBy: reporter`.
 */
export const resolveSource = (model, observation) => {
    const definition = model.sources[observation.source];
    const locator = locatorOf(observation);
    const canonical = (name) => name === undefined ? undefined : (model.registry.instance?.(observation.source, name) ?? name);
    let instance = canonical(instanceOf(observation, definition, locator));
    let secondHand;
    if (definition?.kind === 'identity') {
        // A person source is the person the writer acts for, unless it names
        // someone else: then it counts as the writer's person until that one
        // confirms, so citing a lead raises nothing on its own.
        const principal = canonical(observation.principal);
        if (instance === undefined)
            instance = principal;
        else if (principal !== undefined && instance !== principal) {
            secondHand = instance;
            instance = principal;
        }
    }
    const declared = definition?.attributes ?? {};
    const attributes = {};
    const attested = [];
    const known = instance === undefined ? undefined : model.registry.attributes(observation.source, instance);
    for (const [name, value] of Object.entries(known ?? {})) {
        attributes[name] = value;
        attested.push(name);
    }
    const claimed = [];
    const ignored = [];
    for (const [name, value] of Object.entries(observation.attributes ?? {})) {
        if (declared[name]?.setBy === 'reporter' && !(name in attributes)) {
            attributes[name] = value;
            claimed.push(name);
        }
        else if (!(name in attributes) || attributes[name] !== value) {
            ignored.push(name);
        }
    }
    return {
        source: observation.source,
        instance: instance === undefined ? observation.source : `${observation.source}:${instance}`,
        attributes,
        attested,
        claimed,
        ignored,
        locator,
        ...(secondHand !== undefined ? { secondHand } : {})
    };
};
// --- Matching policies --------------------------------------------------------
const globCache = new Map();
/** `**` crosses directories, `*` and `?` do not; `**\/` may match nothing. */
const globToRegExp = (glob) => {
    let cached = globCache.get(glob);
    if (cached)
        return cached;
    let pattern = '';
    for (let i = 0; i < glob.length; i++) {
        const char = glob[i];
        if (char === '*' && glob[i + 1] === '*') {
            if (glob[i + 2] === '/') {
                pattern += '(?:.*/)?';
                i += 2;
            }
            else {
                pattern += '.*';
                i += 1;
            }
        }
        else if (char === '*')
            pattern += '[^/]*';
        else if (char === '?')
            pattern += '[^/]';
        else
            pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    cached = new RegExp(`^${pattern}$`);
    globCache.set(glob, cached);
    return cached;
};
const listOf = (value) => (Array.isArray(value) ? value : [value]);
/** Whether a condition holds for a value, which is `undefined` when the source does not have it. */
export const conditionHolds = (condition, value) => {
    if (typeof condition !== 'object')
        return value !== undefined && listOf(value).includes(condition);
    const checks = [];
    if (condition.exists !== undefined)
        checks.push((value !== undefined) === condition.exists);
    if (condition.not !== undefined)
        checks.push(!listOf(value).includes(condition.not));
    if (condition.in !== undefined)
        checks.push(value !== undefined && listOf(value).some((item) => condition.in?.includes(item)));
    if (condition.has !== undefined)
        checks.push(value !== undefined && listOf(value).includes(condition.has));
    if (condition.gt !== undefined)
        checks.push(typeof value === 'number' && value > condition.gt);
    if (condition.lt !== undefined)
        checks.push(typeof value === 'number' && value < condition.lt);
    if (condition.matches !== undefined) {
        const pattern = globToRegExp(condition.matches);
        checks.push(value !== undefined && listOf(value).some((item) => typeof item === 'string' && pattern.test(item)));
    }
    return checks.every(Boolean);
};
/** The keys of a policy's `when` that test the source: everything but `about` and `source`. */
export const policyConditions = (policy) => Object.entries(policy.when).filter((entry) => entry[0] !== 'about' && entry[0] !== 'source' && entry[1] !== undefined);
/** How specific a policy is: naming what it is about counts one, and so does each condition. */
export const specificity = (policy) => (policy.when.about !== undefined ? 1 : 0) + policyConditions(policy).length;
const subjectName = (subject) => (subject.kind === 'resource' ? subject.type : subject.rel);
/** Whether a policy applies to an observation of `subject` from `source`. */
export const policyMatches = (policy, subject, source) => {
    if (policy.when.source !== source.source)
        return false;
    if (policy.when.about !== undefined && policy.when.about !== subjectName(subject))
        return false;
    return policyConditions(policy).every(([key, condition]) => conditionHolds(condition, key.startsWith('@') ? source.locator[key.slice(1)] : source.attributes[key]));
};
/** Two decimal places: finer than that is noise, and it keeps projections readable. */
const round = (value) => Math.round(value * 100) / 100;
const clamp = (value, cap) => Math.min(cap, Math.max(0, value));
/**
 * What one observation of `subject` is worth: the most specific matching
 * `score` policy, ties going to the lower score, or the fallback when none
 * matches; then every matching `adjust` policy, added; then held to
 * `[0, cap]`.
 */
export const scoreObservation = (model, subject, observation) => {
    const source = resolveSource(model, observation);
    const matching = model.policies.filter((policy) => policyMatches(policy, subject, source));
    const bases = matching
        .filter((policy) => policy.score !== undefined)
        .sort((a, b) => specificity(b) - specificity(a) || a.score - b.score);
    const adjustments = matching
        .filter((policy) => policy.adjust !== undefined)
        .map((policy) => ({ policy: policy.name, adjust: policy.adjust }));
    const [winner, ...beaten] = bases;
    const start = winner?.score ?? model.fallback;
    const adjusted = adjustments.reduce((total, adjustment) => total + adjustment.adjust, start);
    // Only an adjustment can leave float noise: 0.8 - 0.1 is 0.7000000000000001.
    const score = clamp(adjustments.length > 0 ? round(adjusted) : adjusted, model.cap);
    return {
        source,
        ...(winner ? { base: { policy: winner.name, score: winner.score } } : {}),
        beaten: beaten.map((policy) => ({ policy: policy.name, score: policy.score })),
        adjustments,
        score
    };
};
/** What one observation from `source`, with nothing more said about it, is worth for `subject`. */
export const observationConfidence = (model, subject, source) => scoreObservation(model, subject, { source }).score;
/**
 * Combines independent evidence, showing the working. Observations of one
 * source instance share its failure mode - a second file in the same
 * repository is not a second opinion - so within an instance only the
 * strongest counts. Across instances they are treated as independent:
 * `1 - Π(1 - s)`, held to the cap. An observation that does not say which
 * instance it is from counts with every other such observation of its source
 * type, which is how evidence written before source instances scores.
 *
 * With no evidence at all, a stated confidence (a file's
 * `provenance.confidence`) is taken as given, and otherwise `unevidenced`.
 */
export const explain = (model, subject, evidence, stated) => {
    if (evidence.length === 0) {
        return stated === undefined
            ? { confidence: model.unevidenced, basis: 'unevidenced', evidenceCount: 0, sources: [], observations: [] }
            : { confidence: stated, basis: 'stated', evidenceCount: 0, sources: [], observations: [] };
    }
    const scored = evidence.map((observation) => scoreObservation(model, subject, observation));
    const confirmedNamed = (source, named) => scored.some((candidate) => candidate.source.secondHand === undefined && candidate.source.instance === `${source}:${named}`);
    /** The instance an observation's strength counts toward: the person it names, once confirmed, not the relayer. */
    const groupOf = (observation) => {
        const named = observation.source.secondHand;
        if (named === undefined)
            return observation.source.instance;
        return confirmedNamed(observation.source.source, named) ? `${observation.source.source}:${named}` : observation.source.instance;
    };
    const strongest = new Map();
    scored.forEach((observation, index) => {
        const group = groupOf(observation);
        const best = strongest.get(group);
        if (best === undefined || observation.score > scored[best].score)
            strongest.set(group, index);
    });
    let doubt = 1;
    for (const index of strongest.values())
        doubt *= 1 - scored[index].score;
    const counted = new Set(strongest.values());
    return {
        confidence: round(clamp(1 - doubt, model.cap)),
        basis: 'evidence',
        evidenceCount: evidence.length,
        sources: [...new Set(scored.map(({ source }) => source.source))].sort(),
        observations: scored.map((observation, index) => {
            const named = observation.source.secondHand;
            const confirmed = named === undefined ? undefined : confirmedNamed(observation.source.source, named);
            return { ...observation, counts: counted.has(index), ...(confirmed !== undefined ? { confirmed } : {}) };
        })
    };
};
/** How far `subject` can be trusted on this evidence: `explain` without the working. */
export const assess = (model, subject, evidence, stated) => {
    const { confidence, basis, evidenceCount, sources } = explain(model, subject, evidence, stated);
    return { confidence, basis, evidenceCount, sources };
};
/** The band a confidence falls in: established, probable, or below both, unverified. */
export const bandOf = (model, confidence) => confidence >= model.bands.established ? 'established' : confidence >= model.bands.probable ? 'probable' : 'unverified';
