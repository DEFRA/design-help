import Boom from '@hapi/boom'

import { backendApi } from '#/server/common/helpers/backend-api.js'
import {
  SKILLS,
  SKILL_KEY_SET,
  MAX_EVIDENCE_LENGTH,
  GDAD_SKILLS_MATRIX_URL,
  getFrameworkRolePageLabel,
  roleFrameworkPageUrl
} from '#/server/common/helpers/gdad/constants.js'
import {
  CsvDelimiterError,
  CsvEncodingError,
  REPLACEMENT_CHARACTER,
  decodeCsvUpload,
  parseGdadTemplateCsv
} from '#/server/common/helpers/gdad/csv.js'
import {
  buildCapabilityBand,
  buildSkillRows,
  requireOwnApplicablePerson
} from './helpers.js'

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

const IMPORT_PATH = '/my-gdad-evidence/import-csv'
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024

const IMPORT_ERRORS = {
  noFile: 'Choose a CSV file to upload.',
  empty: 'The selected file is empty',
  tooLarge: 'The selected file must be smaller than 2MB',
  encoding:
    'The selected file could not be read. Save your spreadsheet as CSV UTF-8 and upload it again.',
  unreadable:
    'Could not parse this CSV. Use the reference template format and try again.',
  noSkills: 'Could not find any matching skills in this CSV template.',
  noEvidence:
    'The selected file has no evidence in it. Fill in the SITUATION, TASK, ACTION or RESULT columns for at least one skill and upload it again.'
}

const SKILL_LABELS = new Map(SKILLS.map((skill) => [skill.key, skill.label]))

/**
 * The import form, with one error or a list of them. Each error appears
 * in the error summary (linked to the file field) and beside the field.
 */
function importView(h, errorOrErrors) {
  const errors = [errorOrErrors].flat().filter(Boolean)
  return h
    .view('gdad/import-csv', {
      pageTitle: 'Import GDaD evidence from CSV',
      error: errors.join(' ') || null,
      errorList: errors.map((text) => ({ text, href: '#evidenceCsv' }))
    })
    .code(errors.length ? 400 : 200)
}

/**
 * The upload arrives as a stream (see the route's payload options) so we
 * get the file's raw bytes and can work out its encoding ourselves.
 * Returns `{ filename, buffer }`, or null when no file part was sent.
 */
async function readUploadedFile(part) {
  const item = Array.isArray(part) ? part[0] : part
  if (typeof item === 'string') {
    return { filename: '', buffer: Buffer.from(item, 'utf8') }
  }
  if (!item || typeof item[Symbol.asyncIterator] !== 'function') {
    return null
  }
  const chunks = []
  for await (const chunk of item) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return { filename: item.hapi?.filename ?? '', buffer: Buffer.concat(chunks) }
}

function quoted(text) {
  const short = text.length > 60 ? `${text.slice(0, 60)}…` : text
  return `“${short}”`
}

function unrecognisedRowsMessage(rows) {
  const list = rows
    .map(({ rowNumber, skillText }) =>
      skillText
        ? `row ${rowNumber} (${quoted(skillText)})`
        : `row ${rowNumber} (no skill name)`
    )
    .join(', ')
  const which = rows.length === 1 ? 'This row has' : 'These rows have'
  return `${which} evidence but the SKILL column does not match a GDaD skill: ${list}. Correct the SKILL column to the skill name from the template and upload the file again.`
}

function skillLabel(skillKey) {
  return SKILL_LABELS.get(skillKey) ?? skillKey
}

function listRows(rowNumbers) {
  const rows = rowNumbers.map(String)
  const last = rows.pop()
  return rows.length ? `${rows.join(', ')} and ${last}` : last
}

function duplicateRowsMessages(duplicates) {
  return duplicates.map(
    ({ skillKey, rowNumbers }) =>
      `${skillLabel(skillKey)} has evidence in more than one row (rows ${listRows(rowNumbers)}). Put all the evidence for a skill in one row and upload the file again.`
  )
}

function shortRowsMessage(rows) {
  const list = rows
    .map(
      ({ rowNumber, skillKey }) => `row ${rowNumber} (${skillLabel(skillKey)})`
    )
    .join(', ')
  const which = rows.length === 1 ? 'This row is' : 'These rows are'
  return `${which} missing columns: ${list}. Each row needs SKILL, SITUATION, TASK, ACTION and RESULT columns, as in the template.`
}

/** Everything wrong with the rows, so the designer can fix it all at once. */
function rowProblems({ unrecognisedRows, duplicateSkillRows, shortRows }) {
  const problems = []
  if (unrecognisedRows.length) {
    problems.push(unrecognisedRowsMessage(unrecognisedRows))
  }
  problems.push(...duplicateRowsMessages(duplicateSkillRows))
  if (shortRows.length) {
    problems.push(shortRowsMessage(shortRows))
  }
  if (problems.length) {
    problems[problems.length - 1] += ' Nothing has been saved.'
  }
  return problems
}

/** Line endings and surrounding spaces don’t count as a change. */
function normaliseForCompare(text) {
  return String(text ?? '')
    .replace(/\r\n?/g, '\n')
    .trim()
}

function changedEvidence(person, evidenceBySkill) {
  const saved = person.gdad ?? {}
  return Object.fromEntries(
    Object.entries(evidenceBySkill).filter(
      ([skillKey, text]) =>
        normaliseForCompare(saved[skillKey]?.evidenceText) !==
        normaliseForCompare(text)
    )
  )
}

function importedCountFromQuery(value) {
  if (value === undefined || value === null || value === '') {
    return null
  }
  const count = Number(value)
  return Number.isInteger(count) && count >= 0 ? count : null
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
      const capabilityBand = buildCapabilityBand(skillRows)

      return h.view('gdad/summary', {
        pageTitle: 'My GDaD evidence',
        skillRows,
        capabilityBand,
        headOfDesignSelfReview:
          String(person.role ?? '').trim() === 'Head of Design',
        selfPersonId: person.id,
        csvImportUpdatedCount: importedCountFromQuery(request.query.imported),
        ...frameworkContext(person.role)
      })
    }
  },
  {
    method: 'GET',
    path: IMPORT_PATH,
    async handler(request, h) {
      const { response } = await requireOwnApplicablePerson(request, h)
      if (response) {
        return response
      }
      // A file over the size limit is refused before the POST handler
      // runs, so it comes back here to show the message on the form
      if (request.query.error === 'file-too-large') {
        return importView(h, IMPORT_ERRORS.tooLarge)
      }
      return importView(h, null)
    }
  },
  {
    method: 'POST',
    path: IMPORT_PATH,
    options: {
      payload: {
        output: 'data',
        parse: true,
        multipart: { output: 'stream' },
        maxBytes: MAX_UPLOAD_BYTES,
        allow: 'multipart/form-data',
        failAction(request, h, err) {
          if (err?.output?.statusCode === 413) {
            return h.redirect(`${IMPORT_PATH}?error=file-too-large`).takeover()
          }
          throw err
        }
      }
    },
    async handler(request, h) {
      const { person, response } = await requireOwnApplicablePerson(request, h)
      if (response) {
        return response
      }

      const file = await readUploadedFile(request.payload?.evidenceCsv)
      if (!file || (!file.filename && !file.buffer.length)) {
        return importView(h, IMPORT_ERRORS.noFile)
      }
      if (!file.buffer.length) {
        return importView(h, IMPORT_ERRORS.empty)
      }

      let decoded
      try {
        decoded = decodeCsvUpload(file.buffer)
      } catch (err) {
        if (err instanceof CsvEncodingError) {
          return importView(h, IMPORT_ERRORS.encoding)
        }
        throw err
      }

      const csvText = decoded.trim()
      if (!csvText) {
        return importView(h, IMPORT_ERRORS.empty)
      }
      // Never save text a bad decode has already damaged
      if (csvText.includes(REPLACEMENT_CHARACTER)) {
        return importView(h, IMPORT_ERRORS.encoding)
      }

      let parsed
      try {
        parsed = parseGdadTemplateCsv(csvText)
      } catch (err) {
        return importView(
          h,
          err instanceof CsvDelimiterError
            ? IMPORT_ERRORS.encoding
            : IMPORT_ERRORS.unreadable
        )
      }

      const { evidenceBySkill, matchedSkillKeys } = parsed
      if (!matchedSkillKeys.length) {
        return importView(h, IMPORT_ERRORS.noSkills)
      }
      const problems = rowProblems(parsed)
      if (problems.length) {
        return importView(h, problems)
      }
      if (!Object.keys(evidenceBySkill).length) {
        return importView(h, IMPORT_ERRORS.noEvidence)
      }

      for (const [skillKey, text] of Object.entries(evidenceBySkill)) {
        if (text.length > MAX_EVIDENCE_LENGTH) {
          return importView(
            h,
            `Evidence for ${skillLabel(skillKey)} is too long. It must be ${MAX_EVIDENCE_LENGTH.toLocaleString('en-GB')} characters or fewer, including the Situation, Task, Action and Result labels the import adds.`
          )
        }
      }

      // Only send skills whose evidence has changed: the backend marks
      // every skill it is sent as updated, which would ask the reviewer to
      // score it again
      const changed = changedEvidence(person, evidenceBySkill)
      const changedCount = Object.keys(changed).length
      if (changedCount) {
        await backendApi.saveGdadEvidence(person.id, changed)
      }
      return h.redirect(`/my-gdad-evidence?imported=${changedCount}`)
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
            error: `Evidence must be ${MAX_EVIDENCE_LENGTH.toLocaleString('en-GB')} characters or fewer`,
            evidenceValue: text,
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
