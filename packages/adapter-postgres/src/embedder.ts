/** A vector as pgvector reads it: `[0.1,0.2,...]`. */
export const vectorLiteral = (vector: readonly number[]): string => `[${vector.join(',')}]`
