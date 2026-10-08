import { validateAdapterDefinition, type AdapterDefinition } from '@docket/contracts'

import { resolveAdapterModule, type ModuleResolutionContext } from './resolve-module.js'

/**
 * Imports an adapter module and checks its default export is a definition of
 * a contract major this docket supports - before any of its methods run.
 * Custom modules are trusted project code: they run in-process, with docket's
 * privileges.
 */
export const loadAdapterDefinition = async (
  specifier: string,
  context: ModuleResolutionContext
): Promise<AdapterDefinition> => {
  const label = `Adapter "${context.id}" module "${specifier}"`
  const resolved = resolveAdapterModule(specifier, context)

  let namespace: unknown
  try {
    namespace =
      resolved.kind === 'typescript'
        ? await context.typescript!(resolved.path)
        : ((await import(resolved.url)) as unknown)
  } catch (cause) {
    throw new Error(`${label} failed to load: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }

  const exported =
    typeof namespace === 'object' && namespace !== null ? (namespace as { default?: unknown }).default : undefined
  return validateAdapterDefinition(exported, label)
}
