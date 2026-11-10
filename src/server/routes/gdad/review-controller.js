import Boom from '@hapi/boom'

import { backendApi } from '#/server/common/helpers/backend-api.js'
import {
  canAccessGdadReviewSection,
  canScoreGdadEvidenceForTarget,
  getGdadReviewerRole,
  listReviewablePeople
} from '#/server/common/helpers/gdad/access.js'
import {
  SKILLS,
  SKILL_KEY_SET,
  GDAD_SKILLS_MATRIX_URL,
  getFrameworkRolePageLabel,
  isGdadEvidenceApplicableRole,
  roleFrameworkPageUrl
} from '#/server/common/helpers/gdad/constants.js'
import {
  EXPORT_COLUMNS,
  buildAdminExportCsv
} from '#/server/common/helpers/gdad/csv.js'
import {
  buildCapabilityBand,
  buildSkillRows,
  formatGdadEvidenceTimestamp,
  requireReviewableTarget
} from './helpers.js'
import {
  SCORES_EMAIL_RESULT_FLASH,
  buildScoresEmailPanel,
  canOfferScoresEmail,
  scoresNotifyStatus,
  sendScoresUpdated
} from './scores-notify.js'

function byName(a, b) {
  return String(a.name).localeCompare(String(b.name), undefined, {
    sensitivity: 'base'
  })
}

/**
 * One My team row: progress across the seven skills, capability level and
 * whether anything is waiting for the reviewer.
 */
export function buildTeamRow(person) {
  const skillRows = buildSkillRows(person.gdad, person.role)
  let lastEvidenceAt = null
  for (const skill of skillRows) {
    if (!String(skill.evidenceText).trim() || !skill.evidenceUpdatedAt) {
      continue
    }
    const updatedAt = new Date(skill.evidenceUpdatedAt)
    if (
      !Number.isNaN(updatedAt.getTime()) &&
      (!lastEvidenceAt || updatedAt > lastEvidenceAt)
    ) {
      lastEvidenceAt = updatedAt
    }
  }
  const skillsNeedingScoring = skillRows.filter((s) => s.needsScoring).length
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    managerId: person.managerId ?? null,
    lineManagerName: person.lineManagerName ?? NOT_ALLOCATED,
    skillsWithEvidence: skillRows.filter((s) => String(s.evidenceText).trim())
      .length,
    skillsScored: skillRows.filter((s) => s.officialScore != null).length,
    capabilityBand: buildCapabilityBand(skillRows),
    lastEvidenceLabel: formatGdadEvidenceTimestamp(lastEvidenceAt),
    skillsNeedingScoring,
    needsAttention: skillsNeedingScoring > 0
  }
}

/** Needs-attention first, then by name. */
export function sortTeamRows(rows) {
  return [...rows].sort((a, b) => {
    if (a.needsAttention !== b.needsAttention) {
      return a.needsAttention ? -1 : 1
    }
    return byName(a, b)
  })
}

const NOT_ALLOCATED = 'Not allocated'

/**
 * Everyone on the GDaD path the user may see, sorted by name. Each person
 * gets `lineManagerName`: their manager's name, or "Not allocated" if they
 * have none (or their manager is no longer in Design Help).
 */
async function listEligiblePeople(user) {
  const everyone = await backendApi.listPeople()
  const namesById = new Map(
    everyone.filter((p) => p.name).map((p) => [p.id, p.name])
  )
  const people = await listReviewablePeople(user, everyone)
  return people
    .filter((person) => isGdadEvidenceApplicableRole(person.role))
    .map((person) => ({
      ...person,
      lineManagerName:
        (person.managerId && namesById.get(person.managerId)) || NOT_ALLOCATED
    }))
    .sort(byName)
}

/** The Head of Design's two My team views. */
export const MY_TEAM_VIEWS = {
  whole: 'whole',
  direct: 'direct'
}

/**
 * Which My team view to show the Head of Design. Defaults to the whole
 * team: the Head of Design gives every score, so the whole team is where
 * work waiting for them shows up.
 */
export function chooseMyTeamView(requested) {
  return requested === MY_TEAM_VIEWS.direct
    ? MY_TEAM_VIEWS.direct
    : MY_TEAM_VIEWS.whole
}

function targetViewContext(user, target) {
  return {
    targetPersonId: target.id,
    targetName: target.name,
    targetRole: target.role,
    gdadSkillsMatrixUrl: GDAD_SKILLS_MATRIX_URL,
    frameworkRolePageUrl: roleFrameworkPageUrl(target.role),
    frameworkRoleLabel: getFrameworkRolePageLabel(target.role),
    // Line managers may see scores but only the Head of Design gives them
    canEditScores: canScoreGdadEvidenceForTarget(user, target)
  }
}

function scoringForbidden() {
  return Boom.forbidden('Only the Head of Design can give GDaD scores.')
}

/**
 * All seven `score_<key>` fields: blank clears, otherwise 1–3.
 * Returns `{ scores }` or `{ invalid: true, invalidKey }`.
 */
function parseScorePayload(payload) {
  const scores = {}
  for (const key of SKILL_KEY_SET) {
    const raw = payload?.[`score_${key}`]
    if (raw === undefined || raw === '' || raw === null) {
      scores[key] = null
      continue
    }
    const n = Number(raw)
    if (![1, 2, 3].includes(n)) {
      return { invalid: true, invalidKey: key }
    }
    scores[key] = n
  }
  return { scores }
}

function normaliseScore(value) {
  return value == null || value === '' ? null : Number(value)
}

function isAfter(a, b) {
  const first = a ? new Date(a) : null
  const second = b ? new Date(b) : null
  return Boolean(
    first &&
    second &&
    !Number.isNaN(first.getTime()) &&
    !Number.isNaN(second.getTime()) &&
    first > second
  )
}

/**
 * The skills to send to the backend: those whose score is different from
 * the one already saved, plus those re-confirmed with the same score after
 * the designer updated the evidence (saving marks the new evidence as
 * reviewed and clears "Waiting for a score"). The backend stamps
 * `scoredAt` on every skill it is sent, so sending other unchanged scores
 * would make them look newly scored.
 */
export function changedScores(target, scores) {
  const saved = target?.gdad ?? {}
  const changed = {}
  for (const [key, score] of Object.entries(scores)) {
    const entry = saved[key] ?? {}
    const newScore = normaliseScore(score)
    const scoreChanged = normaliseScore(entry.officialScore) !== newScore
    const reviewsNewEvidence =
      newScore != null && isAfter(entry.evidenceUpdatedAt, entry.scoredAt)
    if (scoreChanged || reviewsNewEvidence) {
      changed[key] = score
    }
  }
  return changed
}

export const gdadReviewRoutes = [
  {
    method: 'GET',
    path: '/my-team',
    async handler(request, h) {
      const user = request.app.user
      if (!canAccessGdadReviewSection(user)) {
        return Boom.forbidden(
          'You do not have permission to review GDaD evidence.'
        )
      }

      const role = getGdadReviewerRole(user)
      const allRows = sortTeamRows(
        (await listEligiblePeople(user)).map(buildTeamRow)
      )
      const directRows = allRows.filter((row) => row.managerId === user.id)

      // Line managers only ever see their own reports, so get no views
      const view = role === 'hod' ? chooseMyTeamView(request.query.view) : null
      const rows = view === MY_TEAM_VIEWS.whole ? allRows : directRows

      return h.view('gdad/my-team', {
        pageTitle: 'My team',
        rows,
        view,
        wholeTeamCount: allRows.length,
        directReportsCount: directRows.length,
        showLineManagerColumn: view === MY_TEAM_VIEWS.whole,
        canScore: role === 'hod',
        attentionCount: rows.filter((row) => row.needsAttention).length,
        skillCount: SKILLS.length,
        gdadReviewerRole: role
      })
    }
  },
  {
    // The old review list now lives at My team
    method: 'GET',
    path: '/review/gdad-evidence',
    handler(_request, h) {
      return h.redirect('/my-team')
    }
  },
  {
    method: 'GET',
    path: '/review/gdad-evidence/export.csv',
    async handler(request, h) {
      const user = request.app.user
      if (!canAccessGdadReviewSection(user)) {
        return Boom.forbidden(
          'You do not have permission to export GDaD scores.'
        )
      }

      const isHod = getGdadReviewerRole(user) === 'hod'
      const exportRows = (await listEligiblePeople(user)).map((person) => {
        const gdad = person.gdad ?? {}
        const row = {
          name: person.name,
          role: person.role,
          lineManager: person.lineManagerName
        }
        for (const col of EXPORT_COLUMNS) {
          const score = gdad[col.key]?.officialScore
          row[col.key] = score == null ? null : Number(score)
        }
        return row
      })

      return h
        .response(
          buildAdminExportCsv(exportRows, { includeLineManager: isHod })
        )
        .type('text/csv')
        .header(
          'content-disposition',
          'attachment; filename="GDaD-scores-export.csv"'
        )
    }
  },
  {
    method: 'GET',
    path: '/review/gdad-evidence/{personId}',
    async handler(request, h) {
      const { target, response } = await requireReviewableTarget(request, h)
      if (response) {
        return response
      }

      const skillRows = buildSkillRows(target.gdad, target.role)
      const hasError = request.query.err === 'invalid'
      // The error is shown next to the score that was not valid, or the
      // first score if we do not know which one it was
      const querySkill = String(request.query.skill ?? '')
      const errorSkillKey = SKILL_KEY_SET.has(querySkill)
        ? querySkill
        : skillRows[0]?.key
      const user = request.app.user
      const canScore = canScoreGdadEvidenceForTarget(user, target)
      const scoresEmail = canScore
        ? await buildScoresEmailPanel(target, user)
        : null
      const [scoresEmailResult] = canScore
        ? request.yar.flash(SCORES_EMAIL_RESULT_FLASH)
        : []
      return h.view('gdad/review-person', {
        pageTitle: `GDaD evidence — ${target.name}`,
        skillRows,
        capabilityBand: buildCapabilityBand(skillRows),
        ...targetViewContext(request.app.user, target),
        justSaved: request.query.saved === '1',
        nothingChanged: request.query.saved === 'none',
        error: hasError
          ? 'Select valid score values (1, 2, 3 or Not set).'
          : null,
        errorSkillKey: hasError ? errorSkillKey : null,
        scoresEmail,
        scoresEmailResult: scoresEmailResult ?? null
      })
    }
  },
  {
    method: 'POST',
    path: '/review/gdad-evidence/{personId}',
    async handler(request, h) {
      const { target, response } = await requireReviewableTarget(request, h)
      if (response) {
        return response
      }
      if (!canScoreGdadEvidenceForTarget(request.app.user, target)) {
        return scoringForbidden()
      }

      const { scores, invalid, invalidKey } = parseScorePayload(request.payload)
      if (invalid) {
        return h.redirect(
          `/review/gdad-evidence/${target.id}?err=invalid&skill=${encodeURIComponent(invalidKey)}`
        )
      }

      const changed = changedScores(target, scores)
      if (!Object.keys(changed).length) {
        return h.redirect(`/review/gdad-evidence/${target.id}?saved=none`)
      }
      await backendApi.saveGdadScores(target.id, changed, request.app.user.id)
      return h.redirect(`/review/gdad-evidence/${target.id}?saved=1`)
    }
  },
  {
    // Head of Design only: email the person (copying in their line manager)
    // to say their scores have been updated. Everything is looked up again
    // from the backend; nothing in the form is trusted.
    method: 'POST',
    path: '/review/gdad-evidence/{personId}/notify-scores',
    async handler(request, h) {
      const { target, response } = await requireReviewableTarget(request, h)
      if (response) {
        return response
      }
      const user = request.app.user
      if (!canScoreGdadEvidenceForTarget(user, target)) {
        return Boom.forbidden(
          'Only the Head of Design can email people about their GDaD scores.'
        )
      }

      const backToPerson = `/review/gdad-evidence/${target.id}`
      if (!canOfferScoresEmail()) {
        request.yar.flash(SCORES_EMAIL_RESULT_FLASH, {
          kind: 'failed',
          text: 'Emailing people about their scores is not set up yet.'
        })
        return h.redirect(backToPerson)
      }
      if (!scoresNotifyStatus(target).hasNewScores) {
        return h.redirect(backToPerson)
      }

      request.yar.flash(
        SCORES_EMAIL_RESULT_FLASH,
        await sendScoresUpdated(user, target)
      )
      return h.redirect(backToPerson)
    }
  },
  {
    method: 'GET',
    path: '/review/gdad-evidence/{personId}/{skillKey}',
    async handler(request, h) {
      const skillKey = String(request.params.skillKey ?? '').trim()
      if (!SKILL_KEY_SET.has(skillKey)) {
        return Boom.notFound()
      }
      const { target, response } = await requireReviewableTarget(request, h)
      if (response) {
        return response
      }

      const skillRows = buildSkillRows(target.gdad, target.role)
      const skill = skillRows.find((s) => s.key === skillKey)

      return h.view('gdad/review-skill', {
        pageTitle: `${skill.label} — ${target.name} — GDaD evidence`,
        skill,
        ...targetViewContext(request.app.user, target),
        justSaved: request.query.saved === '1',
        nothingChanged: request.query.saved === 'none',
        error:
          request.query.err === 'invalid'
            ? 'Select a valid score (1, 2, 3 or Not set).'
            : null
      })
    }
  },
  {
    method: 'POST',
    path: '/review/gdad-evidence/{personId}/{skillKey}',
    async handler(request, h) {
      const skillKey = String(request.params.skillKey ?? '').trim()
      if (!SKILL_KEY_SET.has(skillKey)) {
        return Boom.notFound()
      }
      const { target, response } = await requireReviewableTarget(request, h)
      if (response) {
        return response
      }
      if (!canScoreGdadEvidenceForTarget(request.app.user, target)) {
        return scoringForbidden()
      }

      const raw = request.payload?.[`score_${skillKey}`]
      let score = null
      if (!(raw === undefined || raw === '' || raw === null)) {
        const n = Number(raw)
        if (![1, 2, 3].includes(n)) {
          return h.redirect(
            `/review/gdad-evidence/${target.id}/${encodeURIComponent(skillKey)}?err=invalid`
          )
        }
        score = n
      }

      const skillUrl = `/review/gdad-evidence/${target.id}/${encodeURIComponent(skillKey)}`
      const changed = changedScores(target, { [skillKey]: score })
      if (!Object.keys(changed).length) {
        return h.redirect(`${skillUrl}?saved=none`)
      }
      await backendApi.saveGdadScores(target.id, changed, request.app.user.id)
      return h.redirect(`${skillUrl}?saved=1`)
    }
  }
]
