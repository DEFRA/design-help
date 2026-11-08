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

const HEADER_WORDS = new Set(['situation', 'task', 'action', 'result'])

function cellText(value) {
  return String(value ?? '')
    .replace(/\uFEFF/g, '')
    .trim()
    .toLowerCase()
}

/**
 * True when a row looks like the template's header row: a SKILL-style
 * first heading or one of the STAR headings. Only such a first row is
 * skipped, so a misspelt skill on the first line is still reported.
 */
function looksLikeHeaderRow(row) {
  if (resolveSkillKey(row[0])) {
    return false
  }
  return (
    cellText(firstLineOf(row[0])).includes('skill') ||
    row.slice(1, 5).some((cell) => HEADER_WORDS.has(cellText(cell)))
  )
}

function isBlankRow(row) {
  return !Array.isArray(row) || row.every((cell) => !sanitiseField(cell))
}

/** The cell names a skill exactly, rather than just containing one. */
function namesSkillExactly(value) {
  return SKILL_NAME_TO_KEY.has(normaliseSkillName(value))
}

/**
 * Thrown when we cannot tell whether the file is separated by commas,
 * semicolons or tabs. Guessing wrong would save evidence in the wrong
 * columns, so the route asks the designer to save as CSV UTF-8 instead.
 */
export class CsvDelimiterError extends Error {
  constructor() {
    super('csv_delimiter_ambiguous')
    this.name = 'CsvDelimiterError'
  }
}

function scoreDelimiterParse(rows) {
  const nonBlank = rows.filter((row) => !isBlankRow(row))
  const exactSkillRows = nonBlank.filter((row) =>
    namesSkillExactly(row[0])
  ).length
  const header =
    nonBlank.length > 0 &&
    nonBlank[0].length >= 5 &&
    cellText(nonBlank[0][0]) === 'skill' &&
    looksLikeHeaderRow(nonBlank[0])
  return exactSkillRows + (header ? 1 : 0)
}

/**
 * Reads the file with each delimiter spreadsheet tools use and keeps the
 * one where rows start with an exact skill name (and the template header
 * splits into its headings). Evidence often contains commas, so “parses
 * without error” is not enough: a tab or semicolon file with commas in
 * the evidence also parses as comma-separated, wrongly. A tie between
 * readings that disagree is refused rather than guessed.
 */
function parseRowsWithDelimiterDetection(csvText) {
  const baseOptions = {
    relax_column_count: true,
    skip_empty_lines: false,
    bom: true
  }
  const candidates = []
  let lastError = null
  for (const delimiter of [',', ';', '\t']) {
    try {
      const rows = parse(csvText, { ...baseOptions, delimiter })
      candidates.push({ rows, score: scoreDelimiterParse(rows) })
    } catch (err) {
      lastError = err
    }
  }
  if (!candidates.length) {
    throw lastError || new Error('csv_parse_failed')
  }

  const bestScore = Math.max(...candidates.map((c) => c.score))
  if (bestScore === 0) {
    // No exact skill names anywhere: keep the old order of preference so
    // the route can explain what is wrong with the file
    return candidates[0].rows
  }
  const best = candidates.filter((c) => c.score === bestScore)
  const first = JSON.stringify(best[0].rows)
  if (best.some((c) => JSON.stringify(c.rows) !== first)) {
    throw new CsvDelimiterError()
  }
  return best[0].rows
}

const NUL_CHAR = String.fromCharCode(0)

function hasNulCharacter(text) {
  return text.includes(NUL_CHAR)
}

/** The Unicode replacement character a failed decode leaves behind. */
export const REPLACEMENT_CHARACTER = '\uFFFD'

/**
 * Thrown when an upload is not UTF-8 or UTF-16 and we cannot tell for sure
 * which older encoding it uses. The route asks the designer to save as
 * “CSV UTF-8” rather than guess and garble their evidence.
 */
export class CsvEncodingError extends Error {
  constructor(message = 'csv_encoding_unknown') {
    super(message)
    this.name = 'CsvEncodingError'
  }
}

/*
 * Excel's plain “CSV” on Windows saves Windows-1252 and older Excel for Mac
 * saves Mac Roman. The same byte means different characters in each, so we
 * decode both ways and score the results: typographic punctuation and £
 * are what designers really type; lowercase accents are plausible;
 * capital accents and common symbols are neutral; anything else (control
 * characters, maths symbols, ligatures) means that reading is wrong.
 */
const LEGACY_ENCODINGS = ['windows-1252', 'macintosh']
const LIKELY_CHARACTERS = new Set('’‘“”–—•…£€')
const NEUTRAL_CHARACTERS = new Set('\u00A0°©®™½¼¾·×÷«»¢§¶¡¿´¨')

function scoreLegacyCharacter(ch) {
  if (LIKELY_CHARACTERS.has(ch)) {
    return 3
  }
  if (/^[\u00DF-\u00FF]$/.test(ch) && ch !== '÷') {
    return 1
  }
  if (/^[\u00C0-\u00DE]$/.test(ch) || NEUTRAL_CHARACTERS.has(ch)) {
    return 0
  }
  return null
}

function scoreLegacyDecoding(text) {
  let score = 0
  let unlikely = 0
  for (const ch of text) {
    if (ch.charCodeAt(0) < 0x80) {
      continue
    }
    const value = scoreLegacyCharacter(ch)
    if (value === null) {
      unlikely += 1
    } else {
      score += value
    }
  }
  return { score, unlikely }
}

/**
 * A file that is mostly UTF-8 but has a stray invalid byte (for example
 * text pasted together from two places) would come out as â€™-style
 * gibberish if read as an older encoding, so refuse it instead.
 */
function hasValidUtf8Punctuation(buffer) {
  for (const ch of buffer.toString('utf8')) {
    if (
      ch !== REPLACEMENT_CHARACTER &&
      ch.charCodeAt(0) >= 0x80 &&
      scoreLegacyCharacter(ch) !== null
    ) {
      return true
    }
  }
  return false
}

function decodeLegacyBuffer(buffer) {
  if (hasValidUtf8Punctuation(buffer)) {
    throw new CsvEncodingError()
  }
  const candidates = LEGACY_ENCODINGS.map((encoding) => {
    const text = new TextDecoder(encoding).decode(buffer)
    return { text, ...scoreLegacyDecoding(text) }
  }).sort((a, b) => a.unlikely - b.unlikely || b.score - a.score)

  const [best, next] = candidates
  const confident =
    best.unlikely === 0 &&
    (best.text === next.text || next.unlikely > 0 || best.score > next.score)
  if (!confident) {
    throw new CsvEncodingError()
  }
  return best.text
}

function stripBom(text) {
  return text.startsWith('\uFEFF') ? text.slice(1) : text
}

/**
 * Turns the uploaded bytes into text: UTF-8 (with or without a BOM),
 * UTF-16 (Excel “Unicode Text”) and the older single-byte encodings Excel
 * uses for plain “CSV”. Throws CsvEncodingError when it cannot tell which
 * encoding the file uses.
 */
export function decodeCsvBuffer(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return stripBom(new TextDecoder('utf-16le').decode(buffer))
  }
  if (buffer[0] === 0xfe && buffer[1] === 0xff) {
    return stripBom(new TextDecoder('utf-16be').decode(buffer))
  }
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(buffer)
  }

  // UTF-16 without a BOM: a UTF-8 read leaves NULs between the letters
  const asUtf8 = buffer.toString('utf8')
  if (hasNulCharacter(asUtf8)) {
    return buffer.toString('utf16le')
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer)
  } catch {
    return decodeLegacyBuffer(buffer)
  }
}

/**
 * Decodes an uploaded CSV part. The route reads the raw bytes (a Buffer)
 * so the encoding can be detected; a string is accepted too and assumed
 * to be already decoded. Anything else (for example the `{}` an empty
 * part produces) returns null.
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

function firstLineOf(value) {
  return (
    String(value ?? '')
      .replace(/\uFEFF/g, '')
      .split(/\r\n|\r|\n/)
      .map((s) => s.trim())
      .find(Boolean) ?? ''
  )
}

/**
 * Parses a filled-in template CSV. Columns 1–4 (Situation/Task/Action/
 * Result) are joined into STAR evidence text; the SCORES column is
 * ignored. Returns:
 *
 * - `evidenceBySkill` / `importedSkillKeys` — only skills whose row has
 *   some evidence. Blank rows are left out so they never clear evidence
 *   already saved.
 * - `matchedSkillKeys` — every skill named in the file, blank or not.
 * - Problems the route refuses the file for (row numbers as a
 *   spreadsheet shows them):
 *   - `unrecognisedRows` — `{ rowNumber, skillText }`: evidence but no
 *     recognised skill name. The first row is skipped only when it looks
 *     like the template header.
 *   - `duplicateSkillRows` — `{ skillKey, rowNumbers }`: more than one
 *     row with evidence for the same skill.
 *   - `shortRows` — `{ rowNumber, skillKey }`: a recognised skill with
 *     evidence but fewer than the five SKILL…RESULT columns.
 *
 * Throws CsvDelimiterError when the delimiter cannot be worked out.
 */
export function parseGdadTemplateCsv(csvText) {
  const rows = parseRowsWithDelimiterDetection(csvText)

  const evidenceBySkill = {}
  const matchedSkillKeys = new Set()
  const evidenceRowsBySkill = new Map()
  const unrecognisedRows = []
  const shortRows = []
  let seenFirstRow = false

  rows.forEach((row, index) => {
    if (isBlankRow(row)) {
      return
    }
    const rowNumber = index + 1
    const isFirstRow = !seenFirstRow
    seenFirstRow = true
    if (isFirstRow && looksLikeHeaderRow(row)) {
      return
    }

    // The STAR columns; a SCORES value on its own is not evidence
    const hasContent = row.slice(1, 5).some((cell) => sanitiseField(cell))
    const skillKey = resolveSkillKey(row[0])
    if (!skillKey) {
      if (hasContent) {
        unrecognisedRows.push({ rowNumber, skillText: firstLineOf(row[0]) })
      }
      return
    }
    matchedSkillKeys.add(skillKey)

    if (row.length < 5) {
      if (hasContent) {
        shortRows.push({ rowNumber, skillKey })
      }
      return
    }

    const evidence = buildStarEvidence(
      sanitiseField(row[1]),
      sanitiseField(row[2]),
      sanitiseField(row[3]),
      sanitiseField(row[4])
    )
    if (!evidence) {
      return
    }
    evidenceBySkill[skillKey] = evidence
    const skillRows = evidenceRowsBySkill.get(skillKey) ?? []
    skillRows.push(rowNumber)
    evidenceRowsBySkill.set(skillKey, skillRows)
  })

  const duplicateSkillRows = Array.from(evidenceRowsBySkill.entries())
    .filter(([, rowNumbers]) => rowNumbers.length > 1)
    .map(([skillKey, rowNumbers]) => ({ skillKey, rowNumbers }))

  return {
    evidenceBySkill,
    importedSkillKeys: Object.keys(evidenceBySkill),
    matchedSkillKeys: Array.from(matchedSkillKeys),
    unrecognisedRows,
    duplicateSkillRows,
    shortRows
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

/**
 * Blank STAR template CSV for a grade, or null for an unknown grade. It
 * starts with a UTF-8 byte order mark so Excel for Windows shows the curly
 * quotes in the guidance text correctly.
 */
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
  return `\uFEFF${lines.join('\n')}`
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
  if (
    r === 'Senior Interaction Designer' ||
    r === 'Senior Service Designer' ||
    r === 'Design Manager'
  ) {
    return 'G7'
  }
  if (r === 'Principal Service Designer' || r === 'Head of Design') {
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
