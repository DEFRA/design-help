import Boom from '@hapi/boom'

import { backendApi } from '#/server/common/helpers/backend-api.js'
import {
  SKILL_KEY_SET,
  MAX_EVIDENCE_LENGTH,
  GDAD_SKILLS_MATRIX_URL,
  getCapabilityBandFromScores,
  getFrameworkRolePageLabel,
  roleFrameworkPageUrl
} from '#/server/common/helpers/gdad/constants.js'
import {
  decodeCsvUpload,
  parseGdadTemplateCsv
} from '#/server/common/helpers/gdad/csv.js'
import { buildSkillRows, requireOwnApplicablePerson } from './helpers.js'

function frameworkContext(role) {
  return {
    gdadSkillsMatrixUrl: GDAD_SKILLS_MATRIX_URL,
    frameworkRolePageUrl: roleFrameworkPageUrl(role),
    frameworkRoleLabel: getFrameworkRolePageLabel(role)
  }
}

function skillViewContext(person, skillKey) {
  const skillRows = buildSkillRows(person.gdad, person.role)
  const skill = skillRows.find((s) => s.key === skillKey)
  return {
    pageTitle: `${skill.label} — GDaD evidence`,
    skill,
    ...frameworkContext(person.role)
  }
}

function importView(h, error) {
  return h
    .view('gdad/import-csv', {
      pageTitle: 'Import GDaD evidence from CSV',
      error
    })
    .code(error ? 400 : 200)
}

export const gdadEvidenceRoutes = [
  {
    method: 'GET',
    path: '/my-gdad-evidence',
    async handler(request, h) {
      const { person, response } = await requireOwnApplicablePerson(request, h)
      if (response) {
        return response
      }

      const skillRows = buildSkillRows(person.gdad, person.role)
      const capabilityBand = getCapabilityBandFromScores(
        skillRows.map((s) => s.officialScore)
      )
      if (capabilityBand.ready) {
        capabilityBand.averageLabel = capabilityBand.average.toFixed(2)
      }

      return h.view('gdad/summary', {
        pageTitle: 'My GDaD evidence',
        skillRows,
        capabilityBand,
        headOfDesignSelfReview:
          String(person.role ?? '').trim() === 'Head of Design',
        selfPersonId: person.id,
        csvImportUpdatedCount: Number(request.query.imported || 0),
        ...frameworkContext(person.role)
      })
    }
  },
  {
    method: 'GET',
    path: '/my-gdad-evidence/import-csv',
    async handler(request, h) {
      const { response } = await requireOwnApplicablePerson(request, h)
      if (response) {
        return response
      }
      return importView(h, null)
    }
  },
  {
    method: 'POST',
    path: '/my-gdad-evidence/import-csv',
    options: {
      payload: {
        output: 'data',
        parse: true,
        multipart: true,
        maxBytes: 2 * 1024 * 1024,
        allow: 'multipart/form-data'
      }
    },
    async handler(request, h) {
      const { person, response } = await requireOwnApplicablePerson(request, h)
      if (response) {
        return response
      }

      // Text parts arrive as strings, binary content types as Buffers; an
      // empty or missing file part arrives as something else entirely
      const decoded = decodeCsvUpload(request.payload?.evidenceCsv)
      if (decoded === null) {
        return importView(h, 'Choose a CSV file to upload.')
      }

      const csvText = decoded.trim()
      if (!csvText) {
        return importView(h, 'The uploaded CSV is empty.')
      }

      let parsed
      try {
        parsed = parseGdadTemplateCsv(csvText)
      } catch {
        return importView(
          h,
          'Could not parse this CSV. Use the reference template format and try again.'
        )
      }

      const { evidenceBySkill, importedSkillKeys } = parsed
      if (!importedSkillKeys.length) {
        return importView(
          h,
          'Could not find any matching skills in this CSV template.'
        )
      }

      for (const [skillKey, text] of Object.entries(evidenceBySkill)) {
        if (String(text || '').length > MAX_EVIDENCE_LENGTH) {
          return importView(
            h,
            `Imported text for ${skillKey} is too long (max ${MAX_EVIDENCE_LENGTH} characters).`
          )
        }
      }

      await backendApi.saveGdadEvidence(person.id, evidenceBySkill)
      return h.redirect(
        `/my-gdad-evidence?imported=${importedSkillKeys.length}`
      )
    }
  },
  {
    method: 'GET',
    path: '/my-gdad-evidence/{skillKey}',
    async handler(request, h) {
      const skillKey = String(request.params.skillKey ?? '').trim()
      if (!SKILL_KEY_SET.has(skillKey)) {
        return Boom.notFound()
      }
      const { person, response } = await requireOwnApplicablePerson(request, h)
      if (response) {
        return response
      }

      return h.view('gdad/skill', {
        ...skillViewContext(person, skillKey),
        error: null,
        justSaved: request.query.saved === '1'
      })
    }
  },
  {
    method: 'POST',
    path: '/my-gdad-evidence/{skillKey}',
    async handler(request, h) {
      const skillKey = String(request.params.skillKey ?? '').trim()
      if (!SKILL_KEY_SET.has(skillKey)) {
        return Boom.notFound()
      }
      const { person, response } = await requireOwnApplicablePerson(request, h)
      if (response) {
        return response
      }

      const raw = request.payload?.[`evidence_${skillKey}`]
      const text = String(raw ?? '').trim()
      if (text.length > MAX_EVIDENCE_LENGTH) {
        return h
          .view('gdad/skill', {
            ...skillViewContext(person, skillKey),
            error: `Evidence is too long (max ${MAX_EVIDENCE_LENGTH} characters).`,
            justSaved: false
          })
          .code(400)
      }

      await backendApi.saveGdadEvidence(person.id, { [skillKey]: text })
      return h.redirect(
        `/my-gdad-evidence/${encodeURIComponent(skillKey)}?saved=1`
      )
    }
  }
]
