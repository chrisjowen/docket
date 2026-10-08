import { z } from 'zod'

/**
 * Validates an adapter's configuration, throwing an error that lists each
 * problem by field - never by value, so a misplaced secret is not echoed.
 * Pair it with strict schemas: an unfamiliar field is an error, never
 * silently dropped (docs/adapter-spec.md §4).
 */
export const parseAdapterConfig = <S extends z.ZodType>(schema: S, input: unknown): z.output<S> => {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new Error(z.prettifyError(parsed.error))
  return parsed.data
}
