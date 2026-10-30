/**
 * The contracts between docket and a memory adapter (docs/adapter-spec.md
 * §7-9). An adapter module's default export is an `AdapterDefinition`; docket
 * validates the envelope, lets the adapter validate its own configuration, and
 * validates everything the adapter returns at runtime as well as through these
 * types.
 *
 * Every record here is plain JSON: no Date, BigInt, function or SDK object.
 * Validators accept unknown optional fields so adapters can carry extensions,
 * but an extension never stands in for a required field.
 */
/** The one contract major this package describes. */
export const ADAPTER_API_VERSION = 1;
