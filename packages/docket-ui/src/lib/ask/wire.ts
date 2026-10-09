/*
 * The coordinator's API (docs/adapter-spec.md §10, §14) as this UI reads it:
 * `POST /api/ask`, `GET /api/adapters` and `POST /api/evidence`. The types are
 * defined once, beside the coordinator that serves them. A server without the
 * coordinator is answered through the legacy `GET /api/ask` and `GET /api/chat`,
 * translated into the same shape (see `legacy.ts`).
 */
export type * from '../../../../docket/src/query/wire.js'
