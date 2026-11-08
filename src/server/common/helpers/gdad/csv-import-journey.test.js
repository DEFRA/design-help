import { parse } from 'csv-parse/sync'

import {
  buildAdminExportCsv,
  buildGradeTemplateCsv,
  decodeCsvUpload,
  parseGdadTemplateCsv,
  TEMPLATE_GRADE_CONFIG
} from '#/server/common/helpers/gdad/csv.js'
import { SKILLS } from '#/server/common/helpers/gdad/constants.js'
import {
  LEGACY_SAFE_EVIDENCE,
  UNICODE_EVIDENCE,
  encodeMacRoman,
  encodeWindows1252,
  expectedEvidence,
  fillTemplate,
  readFixture,
  skillKeyForTemplateRow as skillKeyOf,
  toCsv
} from '#/server/common/helpers/gdad/__fixtures__/gdad-csv-fixtures.js'

/*
 * The designer's journey with the GDaD CSV: download a blank template,
 * fill it in with a spreadsheet tool, save, upload. All evidence is
 * made up. Tests marked `it.fails` describe how it SHOULD behave and
 * currently doesn't (known bugs) — they keep the suite green and will
 * start "failing" (i.e. passing) once the bug is fixed, as a reminder to
 * turn them into normal tests.
 */

/** What the upload route does with the uploaded file part, then parse. */
function importFile(value) {
  return parseGdadTemplateCsv(decodeCsvUpload(value).trim())
}

function expectAllSkillsExact(result, evidenceSet) {
  expect(result.importedSkillKeys.sort()).toEqual(
    SKILLS.map((s) => s.key).sort()
  )
  for (const [key, parts] of Object.entries(evidenceSet)) {
    expect(result.evidenceBySkill[key]).toBe(expectedEvidence(parts))
  }
}

const allSkillKeys = SKILLS.map((s) => s.key)

describe('GDaD CSV import — designer journey', () => {
  describe('Download blank template, fill in, upload (round trip)', () => {
    const tools = [
      ['Excel “CSV UTF-8” (BOM, CRLF)', { bom: true, eol: '\r\n' }],
      ['Google Sheets (CRLF, no BOM)', { eol: '\r\n' }],
      ['Numbers (LF, no BOM)', { eol: '\n' }],
      ['old Mac line endings (CR only)', { eol: '\r' }],
      ['every cell quoted', { eol: '\n', quoteAll: true }],
      ['semicolons (European Excel)', { delimiter: ';', bom: true }],
      ['tabs', { delimiter: '\t' }]
    ]

    describe.each(Object.keys(TEMPLATE_GRADE_CONFIG))(
      '%s template',
      (grade) => {
        test.each(tools)(
          'Every skill lands on the right skill, unchanged — %s',
          (_label, options) => {
            const csv = toCsv(fillTemplate(grade, UNICODE_EVIDENCE), options)
            expectAllSkillsExact(
              importFile(Buffer.from(csv, 'utf8')),
              UNICODE_EVIDENCE
            )
            // Hapi hands text/csv parts over as a string rather than a Buffer
            expectAllSkillsExact(importFile(csv), UNICODE_EVIDENCE)
          }
        )
      }
    )

    test('A template filled in for one grade imports the same into any account', () => {
      // The grade only changes the guidance text in the SKILL cell
      const g6 = importFile(toCsv(fillTemplate('g6', UNICODE_EVIDENCE)))
      const seo = importFile(toCsv(fillTemplate('seo', UNICODE_EVIDENCE)))
      expect(g6).toEqual(seo)
    })
  })

  describe('Files saved by real tools (fixtures in __fixtures__/csv)', () => {
    test.each([
      'g7-excel-csv-utf8.csv',
      'g7-google-sheets.csv',
      'g7-numbers.csv',
      'g7-excel-semicolon.csv'
    ])('%s imports every skill exactly', (name) => {
      const file = readFixture(name)
      expectAllSkillsExact(importFile(file), UNICODE_EVIDENCE)
      expectAllSkillsExact(importFile(file.toString('utf8')), UNICODE_EVIDENCE)
    })

    test('Excel “Unicode Text” (UTF-16, tabs) imports exactly when sent as binary', () => {
      expectAllSkillsExact(
        importFile(readFixture('g7-excel-unicode-text.csv')),
        UNICODE_EVIDENCE
      )
    })

    // BUG: browsers send a .csv as text/csv, so hapi decodes it as UTF-8
    // before our UTF-16 fallback sees it — £, curly quotes and emoji are
    // already destroyed. Low impact: Excel saves this format as .txt.
    it.fails(
      'Excel “Unicode Text” keeps £ and curly quotes when sent as text/csv',
      () => {
        const asString = readFixture('g7-excel-unicode-text.csv').toString(
          'utf8'
        )
        expectAllSkillsExact(importFile(asString), UNICODE_EVIDENCE)
      }
    )

    test.each(['g7-excel-windows-1252.csv', 'g7-excel-mac-roman.csv'])(
      'Plain “CSV” %s still finds all seven skills',
      (name) => {
        const result = importFile(readFixture(name))
        expect(result.importedSkillKeys).toHaveLength(SKILLS.length)
      }
    )

    test('Plain “CSV” from Excel for Windows currently turns ’ “ ” £ é – — • into �', () => {
      // Documents the current (broken) behaviour so it is visible in the
      // test output. Delete this when the encoding bug is fixed.
      const result = importFile(readFixture('g7-excel-windows-1252.csv'))
      expect(result.evidenceBySkill.design_communication).toContain('�')
      expect(result.evidenceBySkill.design_communication).not.toContain('£')
    })

    // BUG (high): Excel's plain “CSV (Comma delimited)” and older Mac
    // “Comma Separated Values” are not UTF-8. Every curly apostrophe,
    // quote mark, £, accent, dash and bullet is silently replaced with �
    // and saved over the designer's evidence.
    it.fails.each(['g7-excel-windows-1252.csv', 'g7-excel-mac-roman.csv'])(
      'Plain “CSV” %s keeps ’ “ ” £ é – — • exactly',
      (name) => {
        const result = importFile(readFixture(name))
        expectAllSkillsExact(result, LEGACY_SAFE_EVIDENCE)
      }
    )

    test('The fixture encoders really produce non-UTF-8 bytes', () => {
      expect([...encodeWindows1252('’£')]).toEqual([0x92, 0xa3])
      expect([...encodeMacRoman('’£é')]).toEqual([0xd5, 0xa3, 0x8e])
    })
  })

  describe('Evidence content', () => {
    function importOne(parts) {
      const csv = toCsv(fillTemplate('g7', { iterative_design: parts }))
      return importFile(csv).evidenceBySkill.iterative_design
    }

    test('Keeps commas, double quotes, line breaks and blank lines (STAR paragraphs)', () => {
      const parts = {
        situation: 'Line one, with a comma\n\nLine three after a blank line',
        task: 'She said "ship it", so we did',
        action: '• one\n• two\n\n◦ nested',
        result: '✅ done 🚀'
      }
      expect(importOne(parts)).toBe(expectedEvidence(parts))
    })

    test('Keeps cells that look like spreadsheet formulas as plain text', () => {
      const parts = {
        situation: '=HYPERLINK("http://example.test")',
        task: '+1 more',
        action: '- a dash-led bullet',
        result: '@everyone'
      }
      expect(importOne(parts)).toBe(expectedEvidence(parts))
    })

    test('Trims spaces at the start and end of each column but keeps inner spacing', () => {
      const result = importOne({
        situation: '   padded   ',
        task: '\n\nleading blank lines',
        action: 'two  spaces  inside',
        result: ''
      })
      expect(result).toBe(
        'Situation: padded\n\nTask: leading blank lines\n\nAction: two  spaces  inside'
      )
    })

    test('Keeps Windows line breaks typed inside a cell as they are', () => {
      const result = importOne({ situation: 'a\r\nb' })
      expect(result).toBe('Situation: a\r\nb')
    })

    test('Handles very long cells without truncating (length limit is checked on upload)', () => {
      const long = 'x'.repeat(50000)
      expect(importOne({ situation: long })).toBe(`Situation: ${long}`)
    })

    test('The 12,000 character limit counts the “Situation: ” style labels too', () => {
      // A designer writing 3,000 characters in each of the four columns
      // (12,000 in total) ends up over the limit once labels are added
      const quarter = 'y'.repeat(3000)
      const text = importOne({
        situation: quarter,
        task: quarter,
        action: quarter,
        result: quarter
      })
      // 12,000 + labels (11 + 6 + 8 + 8) + three blank-line separators (6)
      expect(text.length).toBe(12039)
    })
  })

  describe('Partial and odd files', () => {
    test('Blank skill rows are currently imported as empty evidence', () => {
      // Documents current behaviour: the route then saves '' for these
      // skills, which CLEARS any evidence already saved. See the route
      // tests for the overwrite bug.
      const csv = toCsv(
        fillTemplate('g7', {
          iterative_design: UNICODE_EVIDENCE.iterative_design
        })
      )
      const { evidenceBySkill, importedSkillKeys } = importFile(csv)
      expect(importedSkillKeys).toHaveLength(SKILLS.length)
      expect(evidenceBySkill.leading_design).toBe('')
    })

    // BUG (high): a template where the designer only filled in some rows
    // should only import those rows.
    it.fails('Only imports skills that have some evidence filled in', () => {
      const csv = toCsv(
        fillTemplate('g7', {
          iterative_design: UNICODE_EVIDENCE.iterative_design
        })
      )
      const { evidenceBySkill, importedSkillKeys } = importFile(csv)
      expect(importedSkillKeys).toEqual(['iterative_design'])
      expect(evidenceBySkill).not.toHaveProperty('leading_design')
    })

    test('Imports with the header row deleted', () => {
      const [, ...rows] = fillTemplate('g7', UNICODE_EVIDENCE)
      expectAllSkillsExact(importFile(toCsv(rows)), UNICODE_EVIDENCE)
    })

    test('Imports with the header text edited', () => {
      const [, ...rows] = fillTemplate('g7', UNICODE_EVIDENCE)
      const header = ['Skill name', 'S', 'T', 'A', 'R', 'Score']
      expectAllSkillsExact(
        importFile(toCsv([header, ...rows])),
        UNICODE_EVIDENCE
      )
    })

    test('Imports with extra columns added after SCORES', () => {
      const rows = fillTemplate('g7', UNICODE_EVIDENCE).map((row, i) => [
        ...row,
        i === 0 ? 'MY NOTES' : 'private note, not evidence',
        ''
      ])
      expectAllSkillsExact(importFile(toCsv(rows)), UNICODE_EVIDENCE)
    })

    test('Imports with the SCORES column deleted', () => {
      const rows = fillTemplate('g7', UNICODE_EVIDENCE).map((row) =>
        row.slice(0, 5)
      )
      expectAllSkillsExact(importFile(toCsv(rows)), UNICODE_EVIDENCE)
    })

    test('Ignores trailing empty rows and empty columns', () => {
      const rows = fillTemplate('g7', UNICODE_EVIDENCE).map((row) => [
        ...row,
        '',
        ''
      ])
      const csv = toCsv([...rows, ['', '', '', '', '', '', '', ''], ['']])
      expectAllSkillsExact(importFile(csv), UNICODE_EVIDENCE)
    })

    test('Imports when the SKILL cell is cut down to just the skill name', () => {
      const rows = fillTemplate('g7', UNICODE_EVIDENCE).map((row, i) =>
        i === 0 ? row : [String(row[0]).split('\n')[0], ...row.slice(1)]
      )
      expectAllSkillsExact(importFile(toCsv(rows)), UNICODE_EVIDENCE)
    })

    test('Silently skips a row whose SKILL cell was cleared, even if it has evidence', () => {
      const rows = fillTemplate('g7', UNICODE_EVIDENCE).map((row) =>
        skillKeyOf(row) === 'leading_design' ? ['', ...row.slice(1)] : row
      )
      const { importedSkillKeys } = importFile(toCsv(rows))
      expect(importedSkillKeys).not.toContain('leading_design')
      expect(importedSkillKeys).toHaveLength(SKILLS.length - 1)
    })

    test('A SKILL cell naming two skills goes to the first one in the list', () => {
      const csv = 'Leading design and designing together,s,t,a,r,0'
      expect(importFile(csv).importedSkillKeys).toEqual(['designing_together'])
    })

    // BUG (medium): columns are read by position, not by header. If a
    // designer reorders columns, Result text is saved as “Situation: …”.
    it.fails(
      'Reads columns by their header when they have been reordered',
      () => {
        const rows = fillTemplate('g7', UNICODE_EVIDENCE).map((r) => [
          r[0],
          r[4],
          r[3],
          r[2],
          r[1],
          r[5]
        ])
        rows[0] = ['SKILL', 'RESULT', 'ACTION', 'TASK', 'SITUATION', 'SCORES']
        expectAllSkillsExact(importFile(toCsv(rows)), UNICODE_EVIDENCE)
      }
    )

    // BUG (medium): a column inserted before SKILL (e.g. “Name”) means no
    // skill is found at all.
    it.fails(
      'Finds the SKILL column when a column is inserted before it',
      () => {
        const rows = fillTemplate('g7', UNICODE_EVIDENCE).map((r, i) => [
          i === 0 ? 'NAME' : 'Made Up Person',
          ...r
        ])
        expectAllSkillsExact(importFile(toCsv(rows)), UNICODE_EVIDENCE)
      }
    )

    test('A scores export uploaded by mistake imports nothing', () => {
      expect(
        importFile(readFixture('scores-export.csv')).importedSkillKeys
      ).toEqual([])
      // A scores export with several people still matches nothing
      const csv = buildAdminExportCsv([
        { name: 'Made Up One', role: 'Service Designer' },
        { name: 'Made Up Two', role: 'Principal Service Designer' }
      ])
      expect(importFile(csv).importedSkillKeys).toEqual([])
    })

    test('An .xlsx renamed to .csv imports nothing (and does not crash)', () => {
      const file = readFixture('workbook-renamed.xlsx.csv')
      expect(importFile(file).importedSkillKeys).toEqual([])
      expect(importFile(file.toString('utf8')).importedSkillKeys).toEqual([])
    })

    test('A hand-edited file with an unescaped quote mark is rejected as unreadable', () => {
      // Spreadsheet tools always escape quotes, so only a file edited in a
      // text editor hits this; the route shows "Could not parse this CSV"
      const csv = 'Iterative design,he said "hi" to me,t,a,r,0'
      expect(() => importFile(csv)).toThrow(/Invalid Opening Quote/)
    })

    // BUG (low): a semicolon file with no quoted cells anywhere is first
    // read as comma-separated; evidence containing commas then splits
    // into the wrong columns but still matches a skill.
    it.fails(
      'Reads an unquoted semicolon file with commas in the evidence',
      () => {
        const csv =
          'Iterative design;Did a, b, c, d and e;my task;my action;my result;0'
        expect(importFile(csv).evidenceBySkill.iterative_design).toBe(
          'Situation: Did a, b, c, d and e\n\nTask: my task\n\nAction: my action\n\nResult: my result'
        )
      }
    )

    test('A large file near the 2 MB upload limit parses', () => {
      const big = 'z'.repeat(250000)
      const rows = fillTemplate('g7', {
        design_communication: {
          situation: big,
          task: big,
          action: big,
          result: big
        }
      })
      const csv = toCsv(rows)
      expect(Buffer.byteLength(csv)).toBeGreaterThan(1000000)
      expect(importFile(csv).evidenceBySkill.design_communication).toHaveLength(
        expectedEvidence({
          situation: big,
          task: big,
          action: big,
          result: big
        }).length
      )
    })
  })

  describe('Blank template download', () => {
    test.each(Object.keys(TEMPLATE_GRADE_CONFIG))(
      '%s template lists every skill once, with blank STAR columns',
      (grade) => {
        const rows = parse(buildGradeTemplateCsv(grade), {
          relax_column_count: true
        })
        const keys = rows.slice(1).map(skillKeyOf)
        expect(keys.sort()).toEqual([...allSkillKeys].sort())
        for (const row of rows.slice(1)) {
          expect(row.slice(1, 5)).toEqual(['', '', '', ''])
        }
      }
    )

    // BUG (low): the template contains curly quotes (“working”) but has
    // no UTF-8 marker, so Excel for Windows shows them as â€œworkingâ€.
    it.fails(
      'Starts with a UTF-8 marker (BOM) so Excel shows “ ” correctly',
      () => {
        expect(buildGradeTemplateCsv('g7').startsWith('﻿')).toBe(true)
      }
    )
  })
})
