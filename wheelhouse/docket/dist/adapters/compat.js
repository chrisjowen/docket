/** The canonical entity input for a merged entity: its hash is its revision. */
export const toEntityInput = (entity, scope) => {
    const { hash, ...rest } = entity;
    return { ...rest, kind: 'entity', revision: hash, scope };
};
