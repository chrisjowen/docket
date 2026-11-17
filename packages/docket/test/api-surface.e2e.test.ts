import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * The public API, as the built package declares it: every entry point its
 * `exports` names, and the declaration of everything each one exports. The
 * snapshot is the record of what a host may import, so a change to it - an
 * entry point or export added, removed or retyped - is a change to the
 * package's API, made on purpose and reviewed as one. Update it with
 * `pnpm -C packages/docket test -u` after `pnpm build`.
 */

const ROOT = fileURLToPath(new URL('..', import.meta.url))

interface Target {
  types: string
  import: string
}

/** Each entry point with its declarations, by subpath. */
const entryPoints = async (): Promise<Array<[string, Target]>> => {
  const exports: Record<string, Target | string> = JSON.parse(
    await readFile(join(ROOT, 'package.json'), 'utf8')
  ).exports
  return Object.entries(exports)
    .filter((entry): entry is [string, Target] => typeof entry[1] !== 'string')
    .sort(([a], [b]) => a.localeCompare(b))
}

const describeSurface = async (): Promise<string> => {
  const entries = await entryPoints()
  const program = ts.createProgram(
    entries.map(([, target]) => join(ROOT, target.types)),
    {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      types: []
    }
  )
  const checker = program.getTypeChecker()
  const printer = ts.createPrinter({ removeComments: true })
  const where = (file: ts.SourceFile): string => relative(ROOT, file.fileName).split('\\').join('/')

  /** A declaration as it reads in the built package, without its documentation. */
  const declared = (declaration: ts.Declaration): string => {
    const file = declaration.getSourceFile()
    if (ts.isSourceFile(declaration)) return `module ${where(declaration)}`
    const node = ts.isVariableDeclaration(declaration) ? declaration.parent.parent : declaration
    return printer.printNode(ts.EmitHint.Unspecified, node, file)
  }

  const sections = entries.map(([subpath, target]) => {
    const file = program.getSourceFile(join(ROOT, target.types))
    const module = file === undefined ? undefined : checker.getSymbolAtLocation(file)
    if (module === undefined) throw new Error(`${subpath}: no declarations at ${target.types}`)
    const lines = [`## ${subpath} (${target.types})`]
    const exported = [...checker.getExportsOfModule(module)].sort((a, b) => a.name.localeCompare(b.name))
    for (const symbol of exported) {
      const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
      lines.push('', symbol.name)
      for (const declaration of resolved.declarations ?? []) {
        lines.push(...declared(declaration).split('\n').map((line) => `  ${line}`))
      }
    }
    return lines.join('\n')
  })
  return `${sections.join('\n\n')}\n`
}

describe('the public API', () => {
  it('matches its recorded surface', async () => {
    await expect(await describeSurface()).toMatchFileSnapshot('./public-api.snapshot.txt')
  }, 60_000)
})
