/** An entity as a passage: what an agent should read, without its evidence trail (that stays canonical). */
export const renderEntityPassage = (entity) => {
    const lines = [`# ${entity.title}`, `${entity.type} ${entity.id}`];
    const body = entity.content.trim();
    if (body)
        lines.push('', body);
    if (entity.links.length > 0) {
        lines.push('', 'Links:');
        for (const link of entity.links)
            lines.push(`- ${link.rel} ${link.target}`);
    }
    if (entity.tags.length > 0)
        lines.push('', `Tags: ${entity.tags.join(', ')}`);
    return `${lines.join('\n')}\n`;
};
const firstLine = (text, fallback) => {
    const line = text.trim().split('\n', 1)[0]?.trim() ?? '';
    return line.length === 0 ? fallback : line.length > 80 ? `${line.slice(0, 79)}…` : line;
};
/**
 * The passage a recall engine stores for `record`. Observations and documents
 * are stored verbatim; an entity, which has no single source text, as its
 * title, kind, body, links and tags.
 */
export const canonicalPassage = (record) => {
    const base = { kind: record.kind, id: record.id, revision: record.revision };
    switch (record.kind) {
        case 'entity':
            return {
                ref: { ...base, span: { path: record.path } },
                title: record.title,
                text: renderEntityPassage(record)
            };
        case 'observation': {
            const [source] = record.sources;
            return {
                ref: source === undefined ? base : { ...base, span: source },
                title: firstLine(record.text, record.id),
                text: record.text,
                observedAt: record.observedAt,
                ...(record.eventAt !== undefined ? { eventAt: record.eventAt } : {})
            };
        }
        case 'document':
            return {
                ref: { ...base, span: record.source },
                title: firstLine(record.text, record.source.path),
                text: record.text
            };
    }
};
