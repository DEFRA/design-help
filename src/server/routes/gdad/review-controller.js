import Boom from '@hapi/boom'

import { backendApi } from '#/server/common/helpers/backend-api.js'
import {
  canAccessGdadReviewSection,
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

async function listEligiblePeople(user) {
  const people = await listReviewablePeople(user)
  return people
    .filter((person) => isGdadEvidenceApplicableRole(person.role))
    .sort(byName)
}

function targetViewContext(target) {
  return {
    targetPersonId: target.id,
    targetName: target.name,
    targetRole: target.role,
    gdadSkillsMatrixUrl: GDAD_SKILLS_MATRIX_URL,
    frameworkRolePageUrl: roleFrameworkPageUrl(target.role),
    frameworkRoleLabel: getFrameworkRolePageLabel(target.role),
    // View and edit scope are identical in the port (see gdad/access.js)
    canEditScores: true
  }
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

      const rows = sortTeamRows(
        (await listEligiblePeople(user)).map(buildTeamRow)
      )

      return h.view('gdad/my-team', {
        pageTitle: 'My team',
        rows,
        attentionCount: rows.filter((row) => row.needsAttention).length,
        skillCount: SKILLS.length,
        gdadReviewerRole: getGdadReviewerRole(user)
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

      const exportRows = (await listEligiblePeople(user)).map((person) => {
        const gdad = person.gdad ?? {}
        const row = { name: person.name, role: person.role }
        for (const col of EXPORT_COLUMNS) {
          const score = gdad[col.key]?.officialScore
          row[col.key] = score == null ? null : Number(score)
        }
        return row
      })

      return h
        .response(buildAdminExportCsv(exportRows))
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
      return h.view('gdad/review-person', {
        pageTitle: `GDaD evidence — ${target.name}`,
        skillRows,
        capabilityBand: buildCapabilityBand(skillRows),
        ...targetViewContext(target),
        justSaved: request.query.saved === '1',
        error: hasError
          ? 'Select valid score values (1, 2, 3 or Not set).'
          : null,
        errorSkillKey: hasError ? errorSkillKey : null
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

      const { scores, invalid, invalidKey } = parseScorePayload(request.payload)
      if (invalid) {
        return h.redirect(
          `/review/gdad-evidence/${target.id}?err=invalid&skill=${encodeURIComponent(invalidKey)}`
        )
      }

      await backendApi.saveGdadScores(target.id, scores, request.app.user.id)
      return h.redirect(`/review/gdad-evidence/${target.id}?saved=1`)
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
        ...targetViewContext(target),
        justSaved: request.query.saved === '1',
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

      await backendApi.saveGdadScores(
        target.id,
        { [skillKey]: score },
        request.app.user.id
      )
      return h.redirect(
        `/review/gdad-evidence/${target.id}/${encodeURIComponent(skillKey)}?saved=1`
      )
    }
  }
]
