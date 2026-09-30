/** A validation finding. Warnings never fail a non-strict run. */
export interface Diagnostic {
  severity: 'error' | 'warning'
  /** Stable machine code, e.g. `unknown-type`, `dangling-reference`. */
  code: string
  message: string
  /** Repo-relative path of the offending file, when known. */
  path?: string
  /** Memory id of the offending document, when known. */
  id?: string
}

export const error = (
  code: string,
  message: string,
  where: { path?: string; id?: string } = {}
): Diagnostic => ({ severity: 'error', code, message, ...where })

export const warning = (
  code: string,
  message: string,
  where: { path?: string; id?: string } = {}
): Diagnostic => ({ severity: 'warning', code, message, ...where })

export const hasErrors = (diagnostics: Diagnostic[]): boolean =>
  diagnostics.some((d) => d.severity === 'error')
