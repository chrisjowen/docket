/**
 * The icons a resource type can wear in `docket open`, by Lucide name
 * (https://lucide.dev/icons). Self-contained - no imports - so the UI package
 * can share the list and resolve an icon exactly as the server does.
 *
 * The UI bundles only these, so an ontology naming any other icon gets a
 * warning and the fallback.
 */
export const ICON_NAMES = [
  'activity',
  'archive',
  'badge-check',
  'bell',
  'book-open',
  'bot',
  'box',
  'boxes',
  'brain',
  'briefcase',
  'bug',
  'building',
  'calendar',
  'chart-line',
  'circle-dot',
  'clipboard-list',
  'clock',
  'cloud',
  'code',
  'cog',
  'container',
  'cpu',
  'credit-card',
  'database',
  'drafting-compass',
  'eye',
  'file',
  'file-check',
  'file-search',
  'file-text',
  'fingerprint-pattern',
  'flag',
  'flask-conical',
  'folder',
  'folder-git-2',
  'gauge',
  'gavel',
  'git-branch',
  'git-commit-horizontal',
  'git-pull-request',
  'globe',
  'handshake',
  'hard-drive',
  'hash',
  'inbox',
  'key-round',
  'landmark',
  'layers',
  'layout-dashboard',
  'library',
  'lightbulb',
  'link',
  'list-checks',
  'lock',
  'mail',
  'map',
  'megaphone',
  'message-square',
  'milestone',
  'monitor',
  'network',
  'package',
  'plug',
  'puzzle',
  'radio',
  'receipt',
  'rocket',
  'route',
  'scale',
  'scroll-text',
  'server',
  'settings',
  'shield',
  'shield-check',
  'shopping-cart',
  'siren',
  'smartphone',
  'sparkles',
  'stamp',
  'star',
  'tag',
  'target',
  'terminal',
  'triangle-alert',
  'user',
  'users',
  'workflow',
  'wrench',
  'zap'
] as const

export type IconName = (typeof ICON_NAMES)[number]

/** What a type with no icon of its own, and no built-in one, wears. */
export const FALLBACK_ICON: IconName = 'circle-dot'

/**
 * Built-in icons for the starter ontology's types, so an `entities.yaml`
 * written before types could declare one still shows them.
 */
export const DEFAULT_TYPE_ICONS: Readonly<Record<string, IconName>> = {
  agent: 'bot',
  alert: 'bell',
  api: 'plug',
  architecture_record: 'drafting-compass',
  artifact: 'package',
  cluster: 'network',
  compliance_requirement: 'badge-check',
  constraint: 'lock',
  container: 'container',
  dashboard: 'layout-dashboard',
  datasource: 'database',
  decision: 'gavel',
  document: 'file-text',
  endpoint: 'link',
  environment: 'globe',
  event_stream: 'radio',
  feature: 'sparkles',
  feature_flag: 'flag',
  incident: 'siren',
  infrastructure: 'cloud',
  library: 'library',
  model: 'brain',
  organization: 'building',
  permit: 'stamp',
  pipeline: 'workflow',
  pod: 'box',
  policy: 'scroll-text',
  postmortem: 'file-search',
  project: 'briefcase',
  release: 'rocket',
  repository: 'folder-git-2',
  requirement: 'list-checks',
  risk: 'triangle-alert',
  runbook: 'book-open',
  secret: 'key-round',
  service: 'server',
  slo: 'gauge',
  system: 'boxes',
  team: 'users',
  test_suite: 'flask-conical',
  vulnerability: 'bug',
  work_item: 'clipboard-list'
}

const KNOWN: ReadonlySet<string> = new Set(ICON_NAMES)

export const isIconName = (name: string): name is IconName => KNOWN.has(name)

/** A type's icon: the one it declares when docket has it, else its built-in one, else the fallback. */
export const iconFor = (type: string, declared?: string): IconName => {
  if (declared !== undefined && isIconName(declared)) return declared
  return Object.hasOwn(DEFAULT_TYPE_ICONS, type) ? (DEFAULT_TYPE_ICONS[type] as IconName) : FALLBACK_ICON
}
