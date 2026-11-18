import { readdir, readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The core is shared by every deployment, so it imports nothing of any one
 * of them: a module of the package imports its own files, Node's built-ins
 * and the packages listed here - docket, which it validates with, and the
 * YAML library it edits documents with - and never Docket Cloud's.
 */

const SRC = fileURLToPath(new URL('../src', import.meta.url))
const ALLOWED_PACKAGES: readonly string[] = ['@chrisjowen/docket', 'yaml']
// Tests reach a real Postgres with the `pg` driver; the store itself takes any pool and imports none.
const TEST_PACKAGES: readonly string[] = ['vitest', 'pg']
// `docket serve` is a deployment of its own: it makes the pool its Postgres store runs on, with `pg`, an optional peer.
const SERVE_PACKAGES: readonly string[] = ['pg']

const sources = async (dir: string): Promise<string[]> => {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return Promise.resolve(entry.name.endsWith('.ts') ? [path] : [])
    })
  )
  return files.flat()
}

/** Every module specifier a static import, re-export or dynamic import names, as the TypeScript parser resolves it. */
const specifiers = (source: string, fileName = 'source.ts'): string[] => {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const found: string[] = []
  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      if (ts.isStringLiteral(node.moduleSpecifier)) found.push(node.moduleSpecifier.text)
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      if (ts.isStringLiteral(node.moduleReference.expression)) found.push(node.moduleReference.expression.text)
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text)
    } else if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'require' &&
      node.arguments[0] !== undefined &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      found.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(file)
  return found
}

const packageOf = (specifier: string): string =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : (specifier.split('/')[0] as string)

describe('the import boundary', () => {
  it('imports only its own modules, Node built-ins and its listed packages', async () => {
    const outside: string[] = []
    for (const file of await sources(SRC)) {
      const serve = relative(SRC, file).split('\\').join('/').startsWith('serve/') ? SERVE_PACKAGES : []
      const allowed = file.endsWith('.test.ts') ? [...ALLOWED_PACKAGES, ...TEST_PACKAGES, ...serve] : [...ALLOWED_PACKAGES, ...serve]
      for (const specifier of specifiers(await readFile(file, 'utf8'), file)) {
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue
        if (!allowed.includes(packageOf(specifier))) outside.push(`${relative(SRC, file)}: ${specifier}`)
      }
    }
    expect(outside).toEqual([])
  })

  it('finds the imports it checks, including re-exports and dynamic imports', () => {
    expect(
      specifiers(
        [
          "import { a } from './a.js'",
          "import type { B } from '@docket-cloud/tenancy'",
          "export { c } from 'pg'",
          "export * as ns from '@docket-cloud/ns'",
          "import 'side-effect'",
          "const d = await import('node:fs')",
          "const e = require('legacy-pkg')"
        ].join('\n')
      )
    ).toEqual(['./a.js', '@docket-cloud/tenancy', 'pg', '@docket-cloud/ns', 'side-effect', 'node:fs', 'legacy-pkg'])
  })
})
