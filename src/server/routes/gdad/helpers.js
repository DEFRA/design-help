import Boom from '@hapi/boom'

import { backendApi } from '#/server/common/helpers/backend-api.js'
import { canReviewGdadEvidenceForTarget } from '#/server/common/helpers/gdad/access.js'
import {
  SKILLS,
  SCORE_LABELS,
  isGdadEvidenceApplicableRole,
  getCapabilityBandFromScores,
  getExpectedBandForSkillAndRole,
  getGradedLevelForSkillScore,
  skillFrameworkUrl
} from '#/server/common/helpers/gdad/constants.js'

const PERSON_ID_PATTERN = /^[a-f0-9]{24}$/

function toScore(value) {
  return value == null || value === '' ? null : Number(value)
}

/** "10 November 2026", in UK time, or null. */
export function formatGdadDate(value) {
  const d = toDate(value)
  return d
    ? d.toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'Europe/London'
      })
    : null
}

/** An entry from `previous` (newest first), ready to show. */
function buildPreviousEntry(entry) {
  const officialScore = toScore(entry?.officialScore)
  return {
    evidenceText: entry?.evidenceText ?? '',
    evidenceUpdatedLabel: formatGdadEvidenceTimestamp(entry?.evidenceUpdatedAt),
    officialScore,
    scoreLabel: officialScore ? SCORE_LABELS[officialScore] : null,
    scoredDateLabel: formatGdadDate(entry?.scoredAt),
    archivedDateLabel: formatGdadDate(entry?.archivedAt)
  }
}

/**
 * One row per skill for the summary/review tables: skill metadata plus the
 * person's saved evidence, official score and derived bands.
 * `personGdad` is `person.gdad` from the backend (keys may be missing).
 *
 * New evidence is evidence towards the next review, kept beside the
 * current (scored) evidence until the Head of Design scores it. A backend
 * from before new evidence existed sends no `newEvidenceText` key at all:
 * then there is no new evidence and none can be started.
 */
export function buildSkillRows(personGdad, role) {
  const gdad = personGdad ?? {}
  return SKILLS.map((meta) => {
    const row = gdad[meta.key] ?? {}
    const officialScore = toScore(row.officialScore)
    const evidenceText = row.evidenceText ?? ''
    const evidenceUpdatedAt = row.evidenceUpdatedAt ?? null
    const scoredAt = row.scoredAt ?? null
    const hasEvidence = Boolean(String(evidenceText).trim())
    const newEvidenceSupported = row.newEvidenceText !== undefined
    const newEvidenceText = row.newEvidenceText ?? ''
    const hasNewEvidence =
      newEvidenceSupported && Boolean(String(newEvidenceText).trim())
    const newEvidenceUpdatedAt = row.newEvidenceUpdatedAt ?? null
    return {
      ...meta,
      frameworkUrl: skillFrameworkUrl(meta.frameworkHash),
      evidenceText,
      evidenceUpdatedAt,
      evidenceUpdatedLabel: formatGdadEvidenceTimestamp(evidenceUpdatedAt),
      scoredAt,
      scoredDateLabel: formatGdadDate(scoredAt),
      hasNewEvidence,
      newEvidenceText: hasNewEvidence ? newEvidenceText : '',
      newEvidenceUpdatedAt: hasNewEvidence ? newEvidenceUpdatedAt : null,
      newEvidenceUpdatedLabel: hasNewEvidence
        ? formatGdadEvidenceTimestamp(newEvidenceUpdatedAt)
        : null,
      // Offered once the current evidence has been scored
      canStartNewEvidence:
        newEvidenceSupported &&
        hasEvidence &&
        officialScore != null &&
        !hasNewEvidence,
      previous: Array.isArray(row.previous)
        ? row.previous.map(buildPreviousEntry)
        : [],
      needsScoring: skillNeedsScoring(evidenceText, officialScore, {
        evidenceUpdatedAt,
        scoredAt,
        hasNewEvidence
      }),
      officialScore,
      scoreLabel: officialScore ? SCORE_LABELS[officialScore] : null,
      // While there is new evidence the score choice starts blank, and
      // blank leaves the current score alone: picking a score scores the
      // new evidence (see changedScores)
      scoreSelectValue: hasNewEvidence ? null : officialScore,
      blankScoreText: hasNewEvidence ? 'Not scored yet' : 'Not set',
      expectedBand: getExpectedBandForSkillAndRole(meta.key, role),
      gradedLevel: getGradedLevelForSkillScore(meta.key, role, officialScore)
    }
  })
}

function toDate(value) {
  if (!value) {
    return null
  }
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * A skill needs the reviewer's attention when it has evidence but no score,
 * the evidence was added or changed after it was last scored, or there is
 * new evidence waiting to be scored. Scores saved before score dates were
 * recorded have no `scoredAt`; those are not flagged for changed evidence,
 * because there is nothing to compare against.
 */
export function skillNeedsScoring(
  evidenceText,
  officialScore,
  { evidenceUpdatedAt, scoredAt, hasNewEvidence = false }
) {
  if (hasNewEvidence) {
    return true
  }
  if (!String(evidenceText ?? '').trim()) {
    return false
  }
  if (officialScore == null) {
    return true
  }
  const evidenceAt = toDate(evidenceUpdatedAt)
  const scoreAt = toDate(scoredAt)
  return Boolean(evidenceAt && scoreAt && evidenceAt > scoreAt)
}

/** Capability level from the seven skill rows, with a display average. */
export function buildCapabilityBand(skillRows) {
  const band = getCapabilityBandFromScores(
    skillRows.map((s) => s.officialScore)
  )
  if (band.ready) {
    band.averageLabel = band.average.toFixed(2)
  }
  return band
}

export function formatGdadEvidenceTimestamp(value) {
  if (!value) {
    return null
  }
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) {
    return null
  }
  return d.toLocaleString('en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/London'
  })
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
        .view('gdad/not-applicable', {
          pageTitle: 'GDaD evidence',
          personRole: person.role
        })
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
          targetName: target.name,
          targetRole: target.role
        })
        .code(403)
    }
  }
  return { target }
}
