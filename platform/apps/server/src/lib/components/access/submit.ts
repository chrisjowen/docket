// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Where an access form goes on a page that calls the API rather than posting
 * to its own actions: `give`, `adjust` or `revoke`, with the form's fields as
 * a page action reads them (`who`, `place`, `role`, `adjusted`, `cap`, `grant`).
 */
export type AccessSubmit = (action: 'give' | 'adjust' | 'revoke', form: FormData) => void | Promise<void>
