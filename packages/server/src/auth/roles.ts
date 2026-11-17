/** A member's role in a workspace's organisation, most to least privileged. */
export const ROLES = ['owner', 'admin', 'editor', 'viewer'] as const
export type Role = (typeof ROLES)[number]

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}
