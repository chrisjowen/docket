/** Whether the store that holds a document may rewrite it in place: its own documents, not a repo's or a CLI push's. */
export const writableHere = (origin) => origin === 'cloud' || origin === 'local';
