import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import {
  FIXTURE_DIR,
  UNICODE_EVIDENCE,
  LEGACY_SAFE_EVIDENCE,
  fillTemplate,
  toCsv,
  encodeWindows1252,
  encodeMacRoman
} from '#/server/common/helpers/gdad/__fixtures__/gdad-csv-fixtures.js'
import { buildAdminExportCsv } from '#/server/common/helpers/gdad/csv.js'

mkdirSync(FIXTURE_DIR, { recursive: true })
const out = (name, data) => writeFileSync(path.join(FIXTURE_DIR, name), data)

const g7 = fillTemplate('g7', UNICODE_EVIDENCE)
const g7Legacy = fillTemplate('g7', LEGACY_SAFE_EVIDENCE)

// Excel (Windows and Mac) "CSV UTF-8 (Comma delimited)": BOM, CRLF rows,
// LF inside cells, plus the trailing empty rows Excel often leaves
const trailing = [
  ['', '', '', '', '', ''],
  ['', '', '', '', '', '']
]
out(
  'g7-excel-csv-utf8.csv',
  toCsv([...g7, ...trailing], { bom: true, eol: '\r\n' })
)

// Google Sheets "Download > CSV": UTF-8, no BOM, CRLF rows
out('g7-google-sheets.csv', toCsv(g7, { eol: '\r\n' }))

// Numbers "Export To > CSV" (Unicode UTF-8): no BOM, LF rows
out('g7-numbers.csv', toCsv(g7, { eol: '\n' }))

// Excel with European regional settings: semicolon delimiter
out(
  'g7-excel-semicolon.csv',
  toCsv(g7, { delimiter: ';', bom: true, eol: '\r\n' })
)

// Excel for Windows plain "CSV (Comma delimited)": Windows-1252
out(
  'g7-excel-windows-1252.csv',
  encodeWindows1252(toCsv(g7Legacy, { eol: '\r\n' }))
)

// Older Excel for Mac plain "Comma Separated Values": Mac Roman, CR rows
out('g7-excel-mac-roman.csv', encodeMacRoman(toCsv(g7Legacy, { eol: '\r' })))

// Excel "Unicode Text": UTF-16LE with BOM, tab delimited
out(
  'g7-excel-unicode-text.csv',
  Buffer.from(toCsv(g7, { delimiter: '\t', bom: true, eol: '\r\n' }), 'utf16le')
)

// The reviewer scores export, uploaded by mistake
out(
  'scores-export.csv',
  buildAdminExportCsv([
    {
      name: 'Made Up Person',
      role: 'Senior Service Designer',
      design_communication: 2,
      designing_for_everyone: 2,
      designing_strategically: 3,
      designing_together: 2,
      evidence_based_design: 1,
      iterative_design: 2,
      leading_design: 2
    }
  ])
)

// An .xlsx workbook renamed to .csv: starts like a zip file, full of NULs
const zipLike = Buffer.alloc(512)
Buffer.from('PK\u0003\u0004\u0014\u0000\u0006\u0000', 'latin1').copy(zipLike)
Buffer.from('[Content_Types].xml', 'latin1').copy(zipLike, 30)
for (let i = 64; i < zipLike.length; i++) {
  zipLike[i] = (i * 37) % 256
}
out('workbook-renamed.xlsx.csv', zipLike)
