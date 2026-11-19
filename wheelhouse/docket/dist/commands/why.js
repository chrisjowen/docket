import { bandOf, confidenceModel, explain } from '../evidence/confidence.js';
import { validate } from './validate.js';
const part = (model, subject, assessed) => {
    const explanation = explain(model, subject, assessed.evidence, assessed.basis === 'stated' ? assessed.confidence : undefined);
    return { ...explanation, band: bandOf(model, explanation.confidence) };
};
/**
 * Why a resource and each of its links are trusted as far as they are: every
 * observation, the policy that priced it, the ones it beat, the adjustments,
 * the claims that did not count, and which observations count. Read-only.
 */
export const why = async (id, options = {}) => {
    const result = await validate(options);
    const entity = result.entities.find((candidate) => candidate.id === id);
    const diagnostics = result.diagnostics.filter((d) => d.severity === 'error' && (d.id === id || d.id === undefined));
    if (!entity || !result.ontology)
        return { id, links: [], diagnostics };
    const model = confidenceModel(result.ontology);
    return {
        id,
        resource: { type: entity.type, title: entity.title, ...part(model, { kind: 'resource', type: entity.type }, entity) },
        links: entity.links.map((link) => ({
            rel: link.rel,
            target: link.target,
            ...part(model, { kind: 'relationship', rel: link.rel }, link)
        })),
        diagnostics
    };
};
const figure = (value) => value.toFixed(2);
const signed = (value) => `${value < 0 ? '−' : '+'}${figure(Math.abs(value))}`;
const observationLines = (observation) => {
    const { source } = observation;
    const pointer = Object.entries(source.locator)
        .map(([field, value]) => `${field}=${Array.isArray(value) ? value.join(',') : value}`)
        .join(' ');
    const lines = [
        `${observation.counts ? '•' : '·'} ${figure(observation.score)}  ${source.instance}${pointer ? `  ${pointer}` : ''}${observation.counts ? '' : '  (does not count: a stronger observation of the same source does)'}`
    ];
    const attributes = Object.entries(source.attributes)
        .map(([name, value]) => `${name}=${String(value)}${source.claimed.includes(name) ? ' (claimed)' : ''}`)
        .join(', ');
    if (attributes)
        lines.push(`      attributes: ${attributes}`);
    lines.push(observation.base
        ? `      ${figure(observation.base.score)}  "${observation.base.policy}"`
        : `      no policy prices it: the fallback`);
    for (const beaten of observation.beaten)
        lines.push(`      (beat "${beaten.policy}" at ${figure(beaten.score)})`);
    for (const adjustment of observation.adjustments)
        lines.push(`      ${signed(adjustment.adjust)}  "${adjustment.policy}"`);
    if (source.ignored.length)
        lines.push(`      not counted: claimed ${source.ignored.join(', ')}`);
    return lines;
};
const explanationLines = (explanation, indent) => {
    if (explanation.basis === 'unevidenced')
        return [`${indent}no evidence: the ontology's default for a resource without any`];
    if (explanation.basis === 'stated')
        return [`${indent}no evidence: the confidence the file states`];
    const counted = explanation.observations.filter((observation) => observation.counts);
    const formula = counted.length > 1
        ? `${indent}1 − ${counted.map((observation) => `(1 − ${figure(observation.score)})`).join(' × ')} = ${figure(explanation.confidence)}`
        : undefined;
    return [
        ...explanation.observations.flatMap((observation) => observationLines(observation).map((line) => `${indent}${line}`)),
        ...(formula ? [formula] : [])
    ];
};
/** `docket why`'s text. */
export const formatWhy = (result) => {
    const { resource } = result;
    if (!resource)
        return `No valid resource "${result.id}" was found.`;
    const lines = [
        `${result.id}  ${resource.type}  "${resource.title}"`,
        `confidence ${figure(resource.confidence)}, ${resource.band}`,
        ...explanationLines(resource, '  ')
    ];
    for (const link of result.links) {
        lines.push('', `${link.rel} → ${link.target}  ${figure(link.confidence)}, ${link.band}`, ...explanationLines(link, '  '));
    }
    return lines.join('\n');
};
