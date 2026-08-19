import type { AssignmentStatus } from '@/types/db'

/** The setup form, which asks this question itself and asks it better. */
export const SETUP_PATH = '/my-kpi/setup'

/**
 * Is there still somebody to ask which month their KPI starts from?
 *
 * Its own module, away from the modal it drives, because it is the whole
 * rule — and because getting it wrong puts a dialog that cannot be
 * dismissed in front of somebody who has already answered.
 *
 * Two exclusions, the same reason in different shapes: never interrupt
 * a person in the middle of answering. A rejected KPI is on its way back
 * to the setup form, and the setup form is where the question belongs —
 * in context, with the rows in front of them, in a field they can change
 * their mind about before saving.
 *
 * The other half of that promise is not here. A new assignment is
 * created with its start month already on it (useSaveAssignmentRows),
 * so there is no moment where a saved KPI is missing one and this
 * returns true at the person who just filled it in.
 */
export const needsStartMonth = (
  assignment: { starts_from: string | null; status: AssignmentStatus } | null | undefined,
  pathname: string,
): boolean =>
  !!assignment
  && assignment.starts_from === null
  && assignment.status !== 'rejected'
  && !pathname.startsWith(SETUP_PATH)
