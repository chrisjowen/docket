// SPDX-License-Identifier: AGPL-3.0-only
// The `?raw` module type for the templates, which Vite inlines as text.
declare module '*.yaml?raw' {
  const text: string
  export default text
}
