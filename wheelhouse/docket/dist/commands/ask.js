import { askProject } from '../query/ask.js';
/** `docket ask`: one question through the shared coordinator (docs/adapter-spec.md §10, §14). */
export const askCommand = async (question, options = {}) => {
    const { cwd, ...input } = options;
    return (await askProject(cwd ?? process.cwd(), { ...input, question })).answer;
};
const COVERAGE = {
    exhaustive: 'every match',
    'top-k': 'top matches only',
    unknown: 'coverage unknown'
};
const STANDING = {
    resolved: '',
    stale: ' (index behind the files)',
    unresolved: ' (not in the files)'
};
/** One line of text at most `width` long. */
const clip = (text, width = 160) => {
    const line = text.replace(/\s+/g, ' ').trim();
    return line.length > width ? `${line.slice(0, width - 1)}…` : line;
};
const cell = (value) => value === null || value === undefined ? '' : typeof value === 'object' ? value.id : String(value);
const cites = (ids) => (ids && ids.length > 0 ? `  [${ids.join(', ')}]` : '');
const blockLines = (block, evidence, statuses) => {
    const title = block.title ? ` - ${block.title}` : '';
    switch (block.kind) {
        case 'entities':
            return [
                `  entities${title}`,
                ...block.entities.map((item) => `    ${item.ref.id}${item.score === undefined ? '' : `  (${Number(item.score.toFixed(3))})`}${item.detail ? `  ${clip(item.detail, 100)}` : ''}`)
            ];
        case 'passages':
        case 'facts':
            return [
                `  ${block.kind}${title}`,
                ...block.evidenceIds.flatMap((id) => {
                    const item = evidence.get(id);
                    if (!item)
                        return [];
                    const derived = item.kind === 'derived-fact' || item.derivation !== undefined;
                    const refs = item.canonicalRefs.map((ref, index) => `${ref.id}${STANDING[statuses[id]?.[index] ?? 'unresolved']}`).join(', ');
                    return [`    [${id}]${derived ? ' derived' : ''}${refs ? ` ${refs}` : ''}: ${clip(item.text)}`];
                })
            ];
        case 'metric':
            return [`  ${block.label}: ${block.value}${block.unit ? ` ${block.unit}` : ''}${cites(block.evidenceIds)}`];
        case 'table': {
            const rows = [block.columns.map((column) => column.label), ...block.rows.map((row) => block.columns.map((column) => cell(row.cells[column.key])))];
            const widths = block.columns.map((_, index) => Math.min(40, Math.max(...rows.map((row) => (row[index] ?? '').length))));
            const line = (row) => row.map((value, index) => clip(value, 40).padEnd(widths[index] ?? 0)).join('  ').trimEnd();
            return [
                `  table${title}`,
                `    ${line(rows[0] ?? [])}`,
                ...block.rows.map((row, index) => `    ${line(rows[index + 1] ?? [])}${cites(row.evidenceIds)}`)
            ];
        }
        case 'timeline':
            return [
                `  timeline${title}`,
                ...block.events.map((event) => `    ${event.at}  ${event.semantics === 'event' ? 'happened' : event.semantics}  ${event.label}${cites(event.evidenceIds)}`)
            ];
        case 'graph':
            return [
                `  graph${title}`,
                ...block.edges.map((edge) => `    ${edge.source} -${edge.rel}-> ${edge.target}${cites(edge.evidenceIds)}`),
                ...(block.paths ?? []).map((path) => `    path: ${path.join(' → ')}`)
            ];
        default:
            return [`  ${block.kind} block (not shown)`];
    }
};
/** The answer as text: the summary, then each adapter's results as it gave them, then how they connect. */
export const formatAnswer = (answer) => {
    const lines = [`Q. ${answer.question}`];
    if (answer.context)
        lines.push(`   asked ${answer.context.now} (${answer.context.timezone}), scope "${answer.context.scope}"`);
    if (answer.synthesis) {
        lines.push('', `Summary - ${answer.synthesis.model}${answer.synthesis.cached ? ', from the cache' : ''}`, answer.synthesis.text);
    }
    else if (answer.notice && answer.notice.reason !== 'disabled') {
        lines.push('', `No summary: ${answer.notice.message}`);
    }
    for (const result of answer.results) {
        lines.push('');
        const took = result.durationMs === undefined ? '' : `  ${(result.durationMs / 1000).toFixed(2)}s`;
        if (result.state === 'failed') {
            lines.push(`${result.adapter}  ✗ ${result.error.code}${took}`, `  ${result.error.message}`);
            for (const issue of result.issues ?? [])
                lines.push(`    - ${issue}`);
            continue;
        }
        const { interpretation, coverage, blocks, diagnostics } = result.answer;
        lines.push(`${result.adapter}  ${COVERAGE[coverage.mode]}${coverage.truncated ? ', cut short' : ''}${took}`);
        if (interpretation.description)
            lines.push(`  ${interpretation.description.replace(/\n/g, '\n  ')}`);
        if (interpretation.timeRange)
            lines.push(`  time range: ${interpretation.timeRange.from} to ${interpretation.timeRange.to}`);
        if (interpretation.nativeQuery && interpretation.nativeQuery !== answer.question) {
            lines.push(`  query: ${interpretation.nativeQuery.replace(/\n/g, '\n         ')}`);
        }
        for (const diagnostic of diagnostics)
            lines.push(`  ${diagnostic.severity === 'info' ? 'note' : diagnostic.severity}: ${diagnostic.message}`);
        if (blocks.length === 0)
            lines.push('  nothing found');
        const evidence = new Map(result.answer.evidence.map((item) => [item.id, item]));
        for (const block of blocks)
            lines.push(...blockLines(block, evidence, result.references ?? {}));
    }
    if (answer.results.length === 0)
        lines.push('', 'No adapter was asked.');
    if (answer.connections && answer.connections.length > 0) {
        lines.push('', 'How they connect (canonical relationships)');
        for (const path of answer.connections) {
            lines.push(`  ${path.nodes
                .map((id, index) => {
                const step = path.steps[index];
                return step ? `${id} ${step.forward ? `-${step.rel}->` : `<-${step.rel}-`} ` : id;
            })
                .join('')}`);
        }
    }
    return lines;
};
/** One adapter instance's status as text. */
const instanceLines = (instance, defaults) => {
    const fresh = instance.freshness;
    const freshness = fresh?.state === 'current'
        ? 'up to date with the files'
        : fresh?.state === 'behind'
            ? fresh.checkpoint === undefined
                ? 'not synced'
                : `${fresh.behind} change${fresh.behind === 1 ? '' : 's'} behind the files`
            : 'freshness unknown';
    return [
        `${instance.id}  ${instance.status?.state ?? 'status unknown'}${defaults.includes(instance.id) ? '  (asked by default)' : ''}`,
        `  ${instance.module}${instance.description ? ` - ${instance.description.name} ${instance.description.version}` : ''}  roles: ${instance.roles.join(', ') || 'none'}`,
        ...(instance.status?.message ? [`  ${instance.status.message}`] : []),
        ...(instance.statusError ? [`  ✗ ${instance.statusError}`] : []),
        `  ${freshness}${instance.status?.engineVersion ? `, engine ${instance.status.engineVersion}` : ''}${instance.runtime ? `, runtime ${instance.runtime}` : ''}`
    ];
};
/** `docket adapters status` as text. */
export const formatAdapters = (response) => {
    const lines = response.adapters.flatMap((instance, index) => [...(index > 0 ? [''] : []), ...instanceLines(instance, response.query.defaultAdapters)]);
    if (response.adapters.length === 0)
        lines.push('No adapters are configured.');
    return lines;
};
