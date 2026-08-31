/**
 * The four things somebody can be inside Spare, and how to recognise
 * each one in a sheet somebody typed by hand.
 *
 * In a lib rather than beside the table that renders it, because the
 * aliases are the part that can be wrong without anybody noticing: a
 * role spelled "Proj. Manager" that quietly matches nothing means one
 * person keeps the access they were supposed to lose, and the upload
 * reports success. That deserves tests, and tests deserve a module that
 * does not drag a React tree in with it.
 */
export type SpareRole = 'engineer' | 'project_manager' | 'purchase' | 'admin'

export const SPARE_ROLES: { value: SpareRole; label: string; hint: string }[] = [
  { value: 'engineer', label: 'Engineer', hint: 'Scan tags, and ask for changes' },
  { value: 'project_manager', label: 'Project manager', hint: 'Approve requests for their warehouses' },
  // Narrow on purpose, and the hint says so: purchase decides what a
  // spare is and holds no other permission. Somebody assigning roles
  // should be able to see that without opening the module.
  { value: 'purchase', label: 'Purchase', hint: 'Decides which Cyrix item a spare is, and approves that for others' },
  { value: 'admin', label: 'Admin', hint: 'The custom fields, and everything the other three can do' },
]

/**
 * Spellings seen in the wild, plus the obvious short forms.
 *
 * Keys are already stripped to letters, so "Project Manager",
 * "project_manager" and "PROJECT-MANAGER" all arrive here as
 * "projectmanager" and need one entry between them.
 */
const ALIASES: Record<string, SpareRole> = {
  engineer: 'engineer',
  engineers: 'engineer',
  eng: 'engineer',
  technician: 'engineer',
  tech: 'engineer',

  projectmanager: 'project_manager',
  projectmanagers: 'project_manager',
  manager: 'project_manager',
  pm: 'project_manager',
  projectmgr: 'project_manager',
  projmanager: 'project_manager',

  purchase: 'purchase',
  purchasing: 'purchase',
  purchaser: 'purchase',
  buyer: 'purchase',
  procurement: 'purchase',

  admin: 'admin',
  admins: 'admin',
  administrator: 'admin',
  superadmin: 'admin',
}

/**
 * A cell's text as a role, or null when it is not one.
 *
 * Null rather than a default: guessing "engineer" for a word nobody
 * recognises would hand somebody a role from a typo, and the upload
 * would report it as applied. The caller shows the row as skipped and
 * says which word it could not read.
 */
export function normaliseRole(raw: string): SpareRole | null {
  return ALIASES[raw.toLowerCase().replace(/[^a-z]/g, '')] ?? null
}
