const code = (name) => `\`${name}\``;
const list = (items) => items.map((item) => code(String(item))).join(', ');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function setDiff(before, after) {
    return { added: after.filter((x) => !before.includes(x)), removed: before.filter((x) => !after.includes(x)) };
}
function constraintChange(end, before, after) {
    if (same(before, after))
        return [];
    if (before === '*' || after === '*') {
        const show = (c) => (c === '*' ? '*' : `[${c.join(', ')}]`);
        return [`${end}: ${show(before)} → ${show(after)}`];
    }
    const { added, removed } = setDiff(before, after);
    return [...(added.length ? [`${end} += ${list(added)}`] : []), ...(removed.length ? [`${end} −= ${list(removed)}`] : [])];
}
function attributeChanges(owner, before = {}, after = {}) {
    const out = [];
    for (const name of Object.keys(after))
        if (!(name in before))
            out.push({ op: '+', text: `attribute ${code(`${owner}.${name}`)}` });
    for (const name of Object.keys(before))
        if (!(name in after))
            out.push({ op: '-', text: `attribute ${code(`${owner}.${name}`)}` });
    for (const [name, was] of Object.entries(before)) {
        const now = after[name];
        if (!now || same(was, now))
            continue;
        const parts = [];
        if (was.type !== now.type)
            parts.push(`type ${was.type} → ${now.type}`);
        if (!same(was.enum, now.enum)) {
            if (!was.enum)
                parts.push('enum added');
            else if (!now.enum)
                parts.push('enum removed');
            else {
                const { added, removed } = setDiff(was.enum, now.enum);
                if (added.length)
                    parts.push(`enum += ${list(added)}`);
                if (removed.length)
                    parts.push(`enum −= ${list(removed)}`);
            }
        }
        if (was.description !== now.description)
            parts.push('description');
        if (was.setBy !== now.setBy)
            parts.push(`set by ${was.setBy ?? '-'} → ${now.setBy ?? '-'}`);
        out.push({ op: '~', text: `attribute ${code(`${owner}.${name}`)}: ${parts.join(', ')}` });
    }
    return out;
}
function fieldsChanged(before, after, fields) {
    return fields.filter((field) => !same(before[field], after[field]));
}
function sourceChanges(before, after) {
    const out = [];
    for (const name of Object.keys(after))
        if (!(name in before))
            out.push({ op: '+', text: `source ${code(name)}` });
    for (const name of Object.keys(before))
        if (!(name in after))
            out.push({ op: '-', text: `source ${code(name)}` });
    for (const [name, then] of Object.entries(before)) {
        const now = after[name];
        if (!now || same(then, now))
            continue;
        const parts = fieldsChanged(then, now, ['description', 'kind', 'identifiedBy', 'requiresAny']);
        const { added, removed } = setDiff(Object.keys(then.locator ?? {}), Object.keys(now.locator ?? {}));
        if (added.length)
            parts.push(`locator += ${list(added)}`);
        if (removed.length)
            parts.push(`locator −= ${list(removed)}`);
        const changed = Object.keys(then.locator ?? {}).filter((field) => field in (now.locator ?? {}) && !same(then.locator?.[field], now.locator?.[field]));
        if (changed.length)
            parts.push(`locator ~ ${list(changed)}`);
        if (parts.length)
            out.push({ op: '~', text: `source ${code(name)}: ${parts.join(', ')}` });
        out.push(...attributeChanges(`sources.${name}`, then.attributes, now.attributes));
    }
    return out;
}
function trustChanges(before, after, fresh) {
    const out = [];
    for (const setting of ['unevidenced', 'fallback', 'cap']) {
        const was = before[setting];
        const now = after[setting];
        if (fresh && now !== undefined)
            out.push({ op: '+', text: `trust: ${setting} ${now}` });
        else if (!fresh && was !== now)
            out.push({ op: '~', text: `trust: ${setting} ${was ?? 'default'} → ${now ?? 'default'}` });
    }
    for (const setting of ['accept', 'bands']) {
        if (!same(before[setting] ?? {}, after[setting] ?? {}))
            out.push({ op: fresh ? '+' : '~', text: `trust: ${setting} ${JSON.stringify(after[setting] ?? {})}` });
    }
    const policiesBefore = new Map((before.policies ?? []).map((policy) => [policy.name, policy]));
    const policiesAfter = new Map((after.policies ?? []).map((policy) => [policy.name, policy]));
    for (const [name, policy] of policiesAfter) {
        const was = policiesBefore.get(name);
        if (!was)
            out.push({ op: '+', text: `policy ${code(name)}` });
        else if (!same(was, policy)) {
            const parts = fieldsChanged(was, policy, ['when', 'score', 'adjust', 'description']).map((field) => field === 'score' || field === 'adjust' ? `${field} ${was[field] ?? '-'} → ${policy[field] ?? '-'}` : field);
            out.push({ op: '~', text: `policy ${code(name)}: ${parts.join(', ')}` });
        }
    }
    for (const name of policiesBefore.keys())
        if (!policiesAfter.has(name))
            out.push({ op: '-', text: `policy ${code(name)}` });
    return out;
}
/** What changed from one ontology to the next: types, relationships, then sources and trust. */
export function diffOntologies(before, after) {
    const was = before ?? { version: 1, resourceTypes: {}, relationships: {} };
    const out = [];
    for (const name of Object.keys(after.resourceTypes))
        if (!(name in was.resourceTypes))
            out.push({ op: '+', text: `type ${code(name)}` });
    for (const name of Object.keys(was.resourceTypes))
        if (!(name in after.resourceTypes))
            out.push({ op: '-', text: `type ${code(name)}` });
    for (const [name, then] of Object.entries(was.resourceTypes)) {
        const now = after.resourceTypes[name];
        if (!now)
            continue;
        const fields = fieldsChanged(then, now, ['description', 'icon', 'extraction']);
        if (fields.length)
            out.push({ op: '~', text: `type ${code(name)}: ${fields.join(', ')}` });
        out.push(...attributeChanges(name, then.attributes, now.attributes));
    }
    for (const name of Object.keys(after.relationships))
        if (!(name in was.relationships))
            out.push({ op: '+', text: `relationship ${code(name)}` });
    for (const name of Object.keys(was.relationships))
        if (!(name in after.relationships))
            out.push({ op: '-', text: `relationship ${code(name)}` });
    for (const [name, then] of Object.entries(was.relationships)) {
        const now = after.relationships[name];
        if (!now)
            continue;
        const parts = [
            ...constraintChange('from', then.from, now.from),
            ...constraintChange('to', then.to, now.to),
            ...fieldsChanged(then, now, ['description'])
        ];
        if (parts.length)
            out.push({ op: '~', text: `relationship ${code(name)}: ${parts.join(', ')}` });
        out.push(...attributeChanges(name, then.attributes, now.attributes));
    }
    out.push(...sourceChanges(was.sources ?? {}, after.sources ?? {}));
    out.push(...trustChanges(was.trust ?? {}, after.trust ?? {}, !before));
    return out;
}
