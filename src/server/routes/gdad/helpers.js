import Boom from '@hapi/boom'

import { backendApi } from '#/server/common/helpers/backend-api.js'
import { canReviewGdadEvidenceForTarget } from '#/server/common/helpers/gdad/access.js'
import {
  SKILLS,
  SCORE_LABELS,
  isGdadEvidenceApplicableRole,
  getExpectedBandForSkillAndRole,
  getGradedLevelForSkillScore,
  skillFrameworkUrl
} from '#/server/common/helpers/gdad/constants.js'

const PERSON_ID_PATTERN = /^[a-f0-9]{24}$/

/**
 * One row per skill for the summary/review tables: skill metadata plus the
 * person's saved evidence, official score and derived bands.
 * `personGdad` is `person.gdad` from the backend (keys may be missing).
 */
export function buildSkillRows(personGdad, role) {
  const gdad = personGdad ?? {}
  return SKILLS.map((meta) => {
    const row = gdad[meta.key] ?? {}
    const officialScore =
      row.officialScore == null || row.officialScore === ''
        ? null
        : Number(row.officialScore)
    return {
      ...meta,
      frameworkUrl: skillFrameworkUrl(meta.frameworkHash),
      evidenceText: row.evidenceText ?? '',
      evidenceUpdatedAt: row.evidenceUpdatedAt ?? null,
      officialScore,
      scoreLabel: officialScore ? SCORE_LABELS[officialScore] : null,
      expectedBand: getExpectedBandForSkillAndRole(meta.key, role),
      gradedLevel: getGradedLevelForSkillScore(meta.key, role, officialScore)
    }
  })
}

export function formatGdadEvidenceTimestamp(value) {
  if (!value) {
    return null
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) {
    return null
  }
  return d.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Guard for the signed-in designer's own evidence pages: they need a
 * profile (otherwise redirect to create one) with a GDaD-applicable job
 * title (otherwise the 403 "not applicable" page).
 * Returns `{ person }` or `{ response }` for the handler to return.
 */
export async function requireOwnApplicablePerson(request, h) {
  const person = await backendApi.getPerson(request.app.user.id)
  if (!person?.name || !person.role) {
    return { response: h.redirect('/my-profile/edit') }
  }
  if (!isGdadEvidenceApplicableRole(person.role)) {
    return {
      response: h
        .view('gdad/not-applicable', { pageTitle: 'GDaD evidence' })
        .code(403)
    }
  }
  return { person }
}

/**
 * Guard for the review pages: validates the person id, loads the target
 * and checks the signed-in reviewer may see them. A target in a
 * non-applicable job title gets the admin variant of "not applicable".
 * Returns `{ target }` or `{ response }` for the handler to return.
 */
export async function requireReviewableTarget(request, h) {
  const personId = String(request.params.personId ?? '')
  if (!PERSON_ID_PATTERN.test(personId)) {
    return { response: Boom.notFound() }
  }
  const target = await backendApi.getPerson(personId)
  if (!target?.name) {
    return { response: Boom.notFound() }
  }
  if (!canReviewGdadEvidenceForTarget(request.app.user, target)) {
    return {
      response: Boom.forbidden(
        'You do not have permission to review GDaD evidence for this person.'
      )
    }
  }
  if (!isGdadEvidenceApplicableRole(target.role)) {
    return {
      response: h
        .view('gdad/not-applicable', {
          pageTitle: 'GDaD evidence',
          adminContext: true,
          targetName: target.name
        })
        .code(403)
    }
  }
  return { target }
}
