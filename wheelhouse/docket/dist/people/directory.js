import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseYaml } from '../vendor/yaml.js';
import { z } from '../vendor/zod.js';
import { error } from '../model/diagnostic.js';
/** The project's people file, beside its documents. */
export const PEOPLE_FILE = 'people.yaml';
export const EMPTY_DIRECTORY = { people: {} };
const attributeValue = z.union([z.string(), z.number(), z.boolean(), z.array(z.union([z.string(), z.number(), z.boolean()]))]);
const personSchema = z
    .object({ name: z.string().min(1).optional(), aliases: z.array(z.string().min(1)).optional() })
    .catchall(attributeValue)
    .transform(({ name, aliases, ...attributes }) => ({
    ...(name !== undefined ? { name } : {}),
    ...(aliases !== undefined ? { aliases } : {}),
    attributes: attributes
}));
const personId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._@:-]*$/, 'a person id is letters, digits and . _ @ : -');
export const peopleDirectorySchema = z.object({
    me: z.string().min(1).optional(),
    people: z.record(personId, personSchema.nullable().transform((person) => person ?? { attributes: {} })).default({})
});
/** Validates a people directory's text, read from `path`. Never throws: a bad file is a diagnostic and an empty directory. */
export const parsePeople = (raw, path) => {
    let data;
    try {
        data = parseYaml(raw) ?? {};
    }
    catch (cause) {
        return { directory: EMPTY_DIRECTORY, diagnostics: [error('people-parse-error', `${path} is not valid YAML: ${cause.message}`, { path })] };
    }
    const parsed = peopleDirectorySchema.safeParse(data);
    if (!parsed.success) {
        return {
            directory: EMPTY_DIRECTORY,
            diagnostics: parsed.error.issues.map((issue) => error('people-invalid', `${issue.path.join('.') || '(root)'}: ${issue.message}`, { path }))
        };
    }
    return { directory: parsed.data, diagnostics: [] };
};
/** Where a project's people file is: `<memory root>/people.yaml`. */
export const peoplePath = (resolved) => join(resolved.memoryRoot, PEOPLE_FILE);
/** The project's people file as text, or null when it has none. */
export const readPeopleText = async (resolved) => {
    try {
        return await readFile(peoplePath(resolved), 'utf8');
    }
    catch (cause) {
        if (cause.code === 'ENOENT')
            return null;
        throw cause;
    }
};
/** The project's people file, parsed; missing is no one, and a file that does not load is a diagnostic. Never throws. */
export const loadPeople = async (resolved) => {
    const path = peoplePath(resolved);
    try {
        const text = await readPeopleText(resolved);
        return text === null ? { directory: EMPTY_DIRECTORY, diagnostics: [] } : parsePeople(text, path);
    }
    catch (cause) {
        return { directory: EMPTY_DIRECTORY, diagnostics: [error('people-unreadable', `Could not read ${path}: ${cause.message}`, { path })] };
    }
};
/** The person a name means - their id, or one of their aliases, in any case - or undefined when no one in the directory has it. */
export const findPerson = (directory, name) => {
    if (name in directory.people)
        return name;
    const wanted = name.toLowerCase();
    for (const [id, person] of Object.entries(directory.people)) {
        if (id.toLowerCase() === wanted || person.aliases?.some((alias) => alias.toLowerCase() === wanted))
            return id;
    }
    return undefined;
};
/**
 * What the directory attests about a person, as a source of `definition`:
 * only the attributes that source type declares and lets the directory set.
 */
export const directoryAttributes = (directory, definition, name) => {
    const id = findPerson(directory, name);
    if (id === undefined)
        return undefined;
    const declared = definition.attributes ?? {};
    return Object.fromEntries(Object.entries(directory.people[id]?.attributes ?? {}).filter(([attribute]) => declared[attribute]?.setBy === 'directory'));
};
