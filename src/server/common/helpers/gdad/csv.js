import { parse } from 'csv-parse/sync'

import {
  SKILLS,
  getCapabilityBandFromScores,
  getExpectedBandForSkillAndRole,
  skillFrameworkUrl
} from '#/server/common/helpers/gdad/constants.js'

/**
 * CSV import/template/export logic for the GDaD module, ported from the
 * prototype's app/gdad/csv-import.js and app/gdad/routes.js.
 */

const SKILL_NAME_TO_KEY = new Map([
  ['design communication', 'design_communication'],
  ['designing for everyone', 'designing_for_everyone'],
  ['designing strategically', 'designing_strategically'],
  ['designing together', 'designing_together'],
  ['evidence-based design', 'evidence_based_design'],
  ['evidence based design', 'evidence_based_design'],
  ['iterative design', 'iterative_design'],
  ['leading design', 'leading_design']
])

/**
 * The template's SKILL cell packs the skill label, expected band and
 * framework link into one multi-line cell — match on the first non-blank
 * line, ignoring BOMs, quotes, leading ordinals (`1)`, `2.`) and extra
 * whitespace.
 */
function normaliseSkillName(value) {
  const firstLine =
    String(value || '')
      .replace(/\uFEFF/g, '')
      .split('\n')
      .map((s) => s.trim())
      .find(Boolean)
      ?.toLowerCase() || ''
  return firstLine
    .replace(/^[\s"']+|[\s"']+$/g, '')
    .replace(/^\d+\s*[)\].:-]?\s*/, '')
    .replace(/\s+/g, ' ')
}

function sanitiseField(value) {
  return String(value == null ? '' : value).trim()
}

function buildStarEvidence(situation, task, action, result) {
  const parts = []
  if (situation) {
    parts.push(`Situation: ${situation}`)
  }
  if (task) {
    parts.push(`Task: ${task}`)
  }
  if (action) {
    parts.push(`Action: ${action}`)
  }
  if (result) {
    parts.push(`Result: ${result}`)
  }
  return parts.join('\n\n').trim()
}

function resolveSkillKey(rawSkillName) {
  const skillName = normaliseSkillName(rawSkillName)
  if (!skillName) {
    return null
  }
  if (SKILL_NAME_TO_KEY.has(skillName)) {
    return SKILL_NAME_TO_KEY.get(skillName)
  }
  for (const [knownName, skillKey] of SKILL_NAME_TO_KEY.entries()) {
    if (skillName.includes(knownName)) {
      return skillKey
    }
  }
  return null
}

function parseRowsWithDelimiterFallback(csvText) {
  const baseOptions = {
    relax_column_count: true,
    skip_empty_lines: false,
    bom: true
  }
  const delimiterCandidates = [',', ';', '\t']
  let lastError = null
  for (const delimiter of delimiterCandidates) {
    try {
      return parse(csvText, { ...baseOptions, delimiter })
    } catch (err) {
      lastError = err
    }
  }
  throw lastError || new Error('csv_parse_failed')
}

const NUL_CHAR = String.fromCharCode(0)

function hasNulCharacter(text) {
  return text.includes(NUL_CHAR)
}

/**
 * Some spreadsheet exports use UTF-16LE; a UTF-8 decode of those leaves
 * many NUL characters, so fall back when they appear.
 */
export function decodeCsvBuffer(buffer) {
  let csvText = buffer.toString('utf8')
  if (hasNulCharacter(csvText)) {
    csvText = buffer.toString('utf16le')
  }
  return csvText
}

/**
 * Decodes an uploaded CSV part. Hapi's in-memory multipart parsing gives a
 * string for `text/*` parts (already UTF-8 decoded, NULs preserved) and a
 * Buffer for binary content types — accept either. Anything else (for
 * example the `{}` an empty part produces) returns null.
 */
export function decodeCsvUpload(value) {
  if (Buffer.isBuffer(value)) {
    return decodeCsvBuffer(value)
  }
  if (typeof value === 'string') {
    return hasNulCharacter(value)
      ? decodeCsvBuffer(Buffer.from(value, 'utf8'))
      : value
  }
  return null
}

/**
 * Parses a filled-in template CSV to `{ evidenceBySkill, importedSkillKeys }`.
 * Columns 1–4 (Situation/Task/Action/Result) are joined into STAR evidence
 * text; the SCORES column is ignored; unmatched rows are silently skipped
 * and a later duplicate skill row overwrites an earlier one.
 */
export function parseGdadTemplateCsv(csvText) {
  const rows = parseRowsWithDelimiterFallback(csvText)

  const evidenceBySkill = {}
  const importedSkillKeys = new Set()

  for (const row of rows) {
    if (!Array.isArray(row) || row.length < 5) {
      continue
    }

    const skillKey = resolveSkillKey(row[0])
    if (!skillKey) {
      continue
    }

    const situation = sanitiseField(row[1])
    const task = sanitiseField(row[2])
    const action = sanitiseField(row[3])
    const result = sanitiseField(row[4])
    const evidence = buildStarEvidence(situation, task, action, result)

    evidenceBySkill[skillKey] = evidence
    importedSkillKeys.add(skillKey)
  }

  return {
    evidenceBySkill,
    importedSkillKeys: Array.from(importedSkillKeys)
  }
}

export const TEMPLATE_GRADE_CONFIG = {
  seo: { label: 'SEO', role: 'Service Designer' },
  g7: { label: 'G7', role: 'Senior Service Designer' },
  g6: { label: 'G6', role: 'Principal Service Designer' }
}

function csvEscape(value) {
  const s = String(value == null ? '' : value)
  if (
    s.includes('"') ||
    s.includes(',') ||
    s.includes('\n') ||
    s.includes('\r')
  ) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function buildTemplateSkillCell(skill, role, gradeLabel) {
  const expectedBand = getExpectedBandForSkillAndRole(skill.key, role)
  return [
    `${skill.label}`,
    `${expectedBand.label.toUpperCase()} (${gradeLabel})`,
    expectedBand.description,
    `Framework: ${skillFrameworkUrl(skill.frameworkHash)}`
  ].join('\n\n')
}

/** Blank STAR template CSV for a grade, or null for an unknown grade. */
export function buildGradeTemplateCsv(gradeKey) {
  const cfg = TEMPLATE_GRADE_CONFIG[gradeKey]
  if (!cfg) {
    return null
  }

  const lines = ['SKILL,SITUATION,TASK,ACTION,RESULT,SCORES']
  for (const skill of SKILLS) {
    const skillCell = buildTemplateSkillCell(skill, cfg.role, cfg.label)
    const row = [skillCell, '', '', '', '', 0].map(csvEscape).join(',')
    lines.push(row)
  }
  return lines.join('\n')
}

export const EXPORT_COLUMNS = [
  { key: 'design_communication', header: 'Design communication - E' },
  { key: 'designing_for_everyone', header: 'Designing for everyone - E' },
  { key: 'designing_strategically', header: 'Designing strategically - P' },
  { key: 'designing_together', header: 'Designing together - E' },
  { key: 'evidence_based_design', header: 'Evidence based design - E' },
  { key: 'iterative_design', header: 'Iterative design - E' },
  { key: 'leading_design', header: 'Leading design - P' }
]

function roleToExportGrade(role) {
  const r = String(role || '').trim()
  if (r === 'Interaction Designer' || r === 'Service Designer') {
    return 'SEO'
  }
  if (r === 'Senior Interaction Designer' || r === 'Senior Service Designer') {
    return 'G7'
  }
  if (
    r === 'Principal Service Designer' ||
    r === 'Design Manager' ||
    r === 'Head of Design'
  ) {
    return 'G6'
  }
  return ''
}

function roleToExportLabel(role) {
  const r = String(role || '').trim()
  if (r === 'Principal Service Designer') {
    return 'Lead Service Designer'
  }
  return r
}

function bestSixTotal(scores) {
  const valid = (scores || [])
    .map((s) => Number(s))
    .filter((s) => s === 1 || s === 2 || s === 3)
    .sort((a, b) => b - a)
  if (valid.length < 6) {
    return ''
  }
  return valid.slice(0, 6).reduce((sum, s) => sum + s, 0)
}

/**
 * Reviewer score export. `rows` is `[{ name, role, <skillKey>: 1|2|3|null }]`.
 * The last two columns (Score Change, Capability Level Change) are left
 * blank for manual completion, matching the reference Export.csv.
 */
export function buildAdminExportCsv(rows) {
  const header = [
    'Name',
    'Role',
    'Grade',
    ...EXPORT_COLUMNS.map((c) => c.header),
    'Total',
    'Capability Level',
    'Score Change',
    'Capability Level Change'
  ]
  const out = [header.map(csvEscape).join(',')]
  for (const row of rows) {
    const scoreList = EXPORT_COLUMNS.map((c) => row[c.key])
    const total = bestSixTotal(scoreList)
    const capabilityBand =
      total === '' ? null : getCapabilityBandFromScores(scoreList)
    const line = [
      row.name || '',
      roleToExportLabel(row.role),
      roleToExportGrade(row.role),
      ...scoreList.map((s) => (s == null ? '' : s)),
      total,
      capabilityBand && capabilityBand.ready && capabilityBand.band
        ? capabilityBand.band.level
        : '',
      '',
      ''
    ]
    out.push(line.map(csvEscape).join(','))
  }
  return out.join('\n')
}
