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
 * Review-index bucket stats, mirroring the prototype: only skills with
 * non-empty evidence count towards either total.
 */
function buildReviewRow(person) {
  const gdad = person.gdad ?? {}
  let skillsWithEvidence = 0
  let skillsScored = 0
  let lastEvidenceAt = null
  for (const skill of SKILLS) {
    const row = gdad[skill.key]
    if (!String(row?.evidenceText ?? '').trim()) {
      continue
    }
    skillsWithEvidence += 1
    if (row.officialScore != null) {
      skillsScored += 1
    }
    const updatedAt = row.evidenceUpdatedAt
      ? new Date(row.evidenceUpdatedAt)
      : null
    if (
      updatedAt &&
      !Number.isNaN(updatedAt.getTime()) &&
      (!lastEvidenceAt || updatedAt > lastEvidenceAt)
    ) {
      lastEvidenceAt = updatedAt
    }
  }
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    skillsWithEvidence,
    skillsScored,
    lastEvidenceLabel: formatGdadEvidenceTimestamp(lastEvidenceAt)
  }
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
    roleExamplesUrl: roleFrameworkPageUrl(target.role),
    frameworkRoleLabel: getFrameworkRolePageLabel(target.role),
    // View and edit scope are identical in the port (see gdad/access.js)
    canEditScores: true
  }
}

/**
 * All seven `score_<key>` fields: blank clears, otherwise 1–3.
 * Returns `{ scores }` or `{ invalid: true }`.
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
      return { invalid: true }
    }
    scores[key] = n
  }
  return { scores }
}

export const gdadReviewRoutes = [
  {
    method: 'GET',
    path: '/review/gdad-evidence',
    async handler(request, h) {
      const user = request.app.user
      if (!canAccessGdadReviewSection(user)) {
        return Boom.forbidden(
          'You do not have permission to review GDaD evidence.'
        )
      }

      const rows = (await listEligiblePeople(user)).map(buildReviewRow)

      return h.view('gdad/review-index', {
        pageTitle: 'Review GDaD evidence',
        rowsNoOrIncompleteEvidence: rows.filter(
          (row) => row.skillsWithEvidence < SKILLS.length
        ),
        rowsEvidenceUnscored: rows.filter(
          (row) =>
            row.skillsWithEvidence >= SKILLS.length &&
            row.skillsScored < SKILLS.length
        ),
        rowsScoredEvidence: rows.filter(
          (row) => row.skillsScored >= SKILLS.length
        ),
        skillCount: SKILLS.length,
        gdadReviewerRole: getGdadReviewerRole(user)
      })
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
          'attachment; filename="GDaD-admin-export.csv"'
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

      return h.view('gdad/review-person', {
        pageTitle: `GDaD evidence — ${target.name}`,
        skillRows: buildSkillRows(target.gdad, target.role),
        ...targetViewContext(target),
        justSaved: request.query.saved === '1',
        error:
          request.query.err === 'invalid'
            ? 'Select valid score values (1, 2, 3 or Not set).'
            : null
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

      const { scores, invalid } = parseScorePayload(request.payload)
      if (invalid) {
        return h.redirect(`/review/gdad-evidence/${target.id}?err=invalid`)
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
