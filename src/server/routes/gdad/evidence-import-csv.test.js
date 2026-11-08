import { vi } from 'vitest'

import { createServer } from '#/server/server.js'
import { statusCodes } from '#/server/common/constants/status-codes.js'
import { backendApi } from '#/server/common/helpers/backend-api.js'
import { SKILLS } from '#/server/common/helpers/gdad/constants.js'
import {
  UNICODE_EVIDENCE,
  expectedEvidence,
  fillTemplate,
  readFixture,
  toCsv
} from '#/server/common/helpers/gdad/__fixtures__/gdad-csv-fixtures.js'

/*
 * Route-level checks of the "Import GDaD evidence from CSV" page. The
 * signed-in user and the backend are both faked, so no live data is
 * touched. Tests marked `it.fails` describe how it SHOULD behave and
 * currently doesn't (known bugs).
 */
const mockState = { user: null, people: [] }

vi.mock(
  '#/server/common/helpers/auth/user-session.js',
  async (importOriginal) => {
    const original = await importOriginal()
    return {
      ...original,
      refreshSessionUser: async (request) => {
        if (mockState.user) {
          request.yar.set('user', mockState.user)
        }
        return mockState.user
      }
    }
  }
)

vi.mock('#/server/common/helpers/backend-api.js', () => ({
  backendApi: {
    listPeople: async () => mockState.people,
    getPerson: async (id) =>
      mockState.people.find((person) => person.id === id) ?? null,
    saveGdadEvidence: vi.fn(async () => ({})),
    saveGdadScores: vi.fn()
  }
}))

const ids = {
  designer: 'a00000000000000000000011',
  colleague: 'a00000000000000000000012',
  accessibility: 'a00000000000000000000013',
  noProfile: 'a00000000000000000000014'
}

function sessionUser(id, flags = {}) {
  return {
    id,
    email: `${id}@example.test`,
    name: `User ${id}`,
    role: 'Senior Service Designer',
    isAdmin: false,
    isHeadOfDesignSuperUser: false,
    isLineManager: false,
    ...flags
  }
}

const users = {
  designer: sessionUser(ids.designer),
  accessibility: sessionUser(ids.accessibility, {
    role: 'Accessibility Specialist (SEO)'
  }),
  noProfile: sessionUser(ids.noProfile),
  headOfDesign: sessionUser(ids.colleague, {
    role: 'Head of Design',
    isAdmin: true,
    isHeadOfDesignSuperUser: true
  })
}

const SCORED_AT = '2026-10-01T09:00:00.000Z'

function basePeople() {
  return [
    {
      id: ids.designer,
      name: 'Made Up Designer',
      role: 'Senior Service Designer',
      managerId: ids.colleague,
      gdad: {
        leading_design: {
          evidenceText: 'Situation: Evidence I already saved on the website',
          evidenceUpdatedAt: '2026-09-01T09:00:00.000Z',
          officialScore: 2,
          scoredAt: SCORED_AT
        }
      }
    },
    {
      id: ids.colleague,
      name: 'Made Up Colleague',
      role: 'Head of Design',
      managerId: null,
      gdad: {}
    },
    {
      id: ids.accessibility,
      name: 'Made Up Accessibility',
      role: 'Accessibility Specialist (SEO)',
      managerId: null,
      gdad: {}
    },
    { id: ids.noProfile, name: '', role: '', gdad: {} }
  ]
}

const IMPORT_URL = '/my-gdad-evidence/import-csv'
const CRUMB = 'test-crumb'

/** A multipart/form-data body like a browser sends for the upload form. */
function multipartBody({
  file,
  fileName = 'DDAT-GDaD-template-G7.csv',
  contentType = 'text/csv',
  crumb = CRUMB,
  fields = {}
}) {
  const boundary = '----madeUpBoundary7MA4YWxkTrZu0gW'
  const parts = []
  const allFields = crumb === null ? fields : { crumb, ...fields }
  for (const [name, value] of Object.entries(allFields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`
      )
    )
  }
  if (file !== undefined) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="evidenceCsv"; filename="${fileName}"\r\nContent-Type: ${contentType}\r\n\r\n`
      ),
      Buffer.isBuffer(file) ? file : Buffer.from(file, 'utf8'),
      Buffer.from('\r\n')
    )
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return {
    payload: Buffer.concat(parts),
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      cookie: `crumb=${CRUMB}`
    }
  }
}

describe('#gdadEvidenceRoutes CSV import', () => {
  let server

  beforeAll(async () => {
    server = await createServer()
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop({ timeout: 0 })
  })

  beforeEach(() => {
    mockState.people = basePeople()
    mockState.user = users.designer
  })

  function get(url) {
    return server.inject({ method: 'GET', url })
  }

  function upload(options) {
    return server.inject({
      method: 'POST',
      url: IMPORT_URL,
      ...multipartBody(options)
    })
  }

  function savedEvidence() {
    expect(backendApi.saveGdadEvidence).toHaveBeenCalledTimes(1)
    return backendApi.saveGdadEvidence.mock.calls[0]
  }

  const fullTemplate = () => toCsv(fillTemplate('g7', UNICODE_EVIDENCE))
  const partialTemplate = () =>
    toCsv(
      fillTemplate('g7', {
        design_communication: UNICODE_EVIDENCE.design_communication,
        iterative_design: UNICODE_EVIDENCE.iterative_design
      })
    )

  describe('The import page', () => {
    test('Shows the upload form with template links and a CSRF token', async () => {
      const { statusCode, result } = await get(IMPORT_URL)
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('Import GDaD evidence from CSV')
      for (const grade of ['seo', 'g7', 'g6']) {
        expect(result).toContain(`/gdad-reference/template-${grade}.csv`)
      }
      expect(result).toContain('enctype="multipart/form-data"')
      expect(result).toMatch(/name="crumb" value="[^"]+"/)
    })

    test.each(['seo', 'g7', 'g6'])(
      'Downloads the %s template as a UTF-8 CSV attachment',
      async (grade) => {
        const { statusCode, headers } = await get(
          `/gdad-reference/template-${grade}.csv`
        )
        expect(statusCode).toBe(statusCodes.ok)
        expect(headers['content-type']).toBe('text/csv; charset=utf-8')
        expect(headers['content-disposition']).toContain(
          `DDAT-GDaD-template-${grade.toUpperCase()}.csv`
        )
      }
    )

    // Not a bug as such, but worth knowing: there is no "check your
    // answers" step. One click saves straight over existing evidence.
    it.todo(
      'Shows a preview of what will change and asks to confirm before overwriting saved evidence'
    )
  })

  describe('Who can import', () => {
    test('Saves only to the signed-in designer’s own record', async () => {
      const { statusCode, headers } = await upload({ file: fullTemplate() })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/my-gdad-evidence?imported=7')
      const [personId] = savedEvidence()
      expect(personId).toBe(ids.designer)
    })

    test('Ignores any person id smuggled into the form', async () => {
      await upload({
        file: fullTemplate(),
        fields: { personId: ids.colleague, id: ids.colleague }
      })
      expect(savedEvidence()[0]).toBe(ids.designer)
    })

    test('Has no address for importing into someone else’s record', async () => {
      const { statusCode } = await server.inject({
        method: 'POST',
        url: `/review/gdad-evidence/${ids.designer}/import-csv`,
        ...multipartBody({ file: fullTemplate() })
      })
      // Lands on the single-skill review save route, which refuses the
      // upload outright (415 unsupported, as it does not accept files)
      expect(statusCode).toBeGreaterThanOrEqual(400)
      expect(statusCode).toBeLessThan(500)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
    })

    test('Ignores a person id in the address', async () => {
      await server.inject({
        method: 'POST',
        url: `${IMPORT_URL}?personId=${ids.colleague}`,
        ...multipartBody({ file: fullTemplate() })
      })
      expect(savedEvidence()[0]).toBe(ids.designer)
    })

    test('Even the Head of Design imports only into their own record', async () => {
      mockState.user = users.headOfDesign
      await upload({ file: fullTemplate(), fields: { personId: ids.designer } })
      expect(savedEvidence()[0]).toBe(ids.colleague)
    })

    test('Sends signed-out visitors to sign in and saves nothing', async () => {
      mockState.user = null
      const { statusCode, headers } = await upload({ file: fullTemplate() })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/sign-in')
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })

    test('Refuses an upload without the CSRF token', async () => {
      const { statusCode } = await upload({
        file: fullTemplate(),
        crumb: null
      })
      expect(statusCode).toBe(statusCodes.forbidden)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })

    test('Refuses an upload with the wrong CSRF token', async () => {
      const { statusCode } = await upload({
        file: fullTemplate(),
        crumb: 'not-the-cookie-value'
      })
      expect(statusCode).toBe(statusCodes.forbidden)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })

    test('Sends someone with no profile to create one and saves nothing', async () => {
      mockState.user = users.noProfile
      const { statusCode, headers } = await upload({ file: fullTemplate() })
      expect(statusCode).toBe(302)
      expect(headers.location).toBe('/my-profile/edit')
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })

    test('Refuses job titles not on the GDaD path and saves nothing', async () => {
      mockState.user = users.accessibility
      const { statusCode } = await upload({ file: fullTemplate() })
      expect(statusCode).toBe(statusCodes.forbidden)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })
  })

  describe('Successful imports', () => {
    test.each([
      ['Excel CSV UTF-8', 'g7-excel-csv-utf8.csv', 'text/csv'],
      // Windows browsers with Excel installed label .csv files like this
      ['Excel CSV UTF-8', 'g7-excel-csv-utf8.csv', 'application/vnd.ms-excel'],
      ['Google Sheets', 'g7-google-sheets.csv', 'text/csv'],
      ['Numbers', 'g7-numbers.csv', 'text/csv'],
      ['semicolon Excel', 'g7-excel-semicolon.csv', 'text/csv'],
      [
        'Excel Unicode Text',
        'g7-excel-unicode-text.csv',
        'application/octet-stream'
      ]
    ])(
      'Saves all seven skills exactly from %s (%s as %s)',
      async (_tool, fixture, contentType) => {
        const { statusCode, headers } = await upload({
          file: readFixture(fixture),
          contentType
        })
        expect(statusCode).toBe(302)
        expect(headers.location).toBe('/my-gdad-evidence?imported=7')
        const [, evidence] = savedEvidence()
        expect(Object.keys(evidence).sort()).toEqual(
          SKILLS.map((s) => s.key).sort()
        )
        for (const [key, parts] of Object.entries(UNICODE_EVIDENCE)) {
          expect(evidence[key]).toBe(expectedEvidence(parts))
        }
      }
    )

    test('Shows a success banner on the evidence overview', async () => {
      const { statusCode, result } = await get('/my-gdad-evidence?imported=7')
      expect(statusCode).toBe(statusCodes.ok)
      expect(result).toContain('govuk-notification-banner--success')
      expect(result).toContain('Imported evidence for 7 skill(s).')
    })

    test('Never touches scores: only evidence is sent to the backend', async () => {
      await upload({ file: fullTemplate() })
      expect(backendApi.saveGdadScores).not.toHaveBeenCalled()
      const [, evidence] = savedEvidence()
      for (const value of Object.values(evidence)) {
        expect(typeof value).toBe('string')
      }
    })

    test('Saves straight away — there is no confirm step', async () => {
      const { statusCode } = await upload({ file: fullTemplate() })
      expect(statusCode).toBe(302)
      expect(backendApi.saveGdadEvidence).toHaveBeenCalledTimes(1)
    })
  })

  describe('Partly filled-in template (the overwrite risk)', () => {
    test('Currently sends blank text for every unfilled skill, which clears saved evidence', async () => {
      // Documents current behaviour. The backend turns '' into "no
      // evidence", so the Leading design evidence this designer saved on
      // the website is wiped. Delete this test when the bug is fixed.
      const { headers } = await upload({ file: partialTemplate() })
      const [, evidence] = savedEvidence()
      expect(evidence.leading_design).toBe('')
      expect(Object.keys(evidence)).toHaveLength(7)
      expect(headers.location).toBe('/my-gdad-evidence?imported=7')
    })

    // BUG (critical): uploading a template with only some rows filled in
    // must not wipe evidence already saved for the other skills.
    it.fails('Leaves skills with blank rows alone', async () => {
      await upload({ file: partialTemplate() })
      const [, evidence] = savedEvidence()
      expect(Object.keys(evidence).sort()).toEqual([
        'design_communication',
        'iterative_design'
      ])
    })

    // BUG (medium): the success message counts blank rows as imported.
    it.fails(
      'Counts only the skills that had evidence in the file',
      async () => {
        const { headers } = await upload({ file: partialTemplate() })
        expect(headers.location).toBe('/my-gdad-evidence?imported=2')
      }
    )

    // BUG (medium): uploading the same file again re-saves identical
    // evidence; the backend stamps it as "changed", so already-scored
    // skills get flagged to the reviewer as needing re-scoring.
    it.fails('Does not re-save evidence that has not changed', async () => {
      mockState.people[0].gdad = Object.fromEntries(
        Object.entries(UNICODE_EVIDENCE).map(([key, parts]) => [
          key,
          {
            evidenceText: expectedEvidence(parts),
            officialScore: 2,
            scoredAt: SCORED_AT
          }
        ])
      )
      await upload({ file: fullTemplate() })
      const calls = backendApi.saveGdadEvidence.mock.calls
      const sentKeys = calls.flatMap(([, evidence]) => Object.keys(evidence))
      expect(sentKeys).toEqual([])
    })

    // BUG (medium): a row whose SKILL cell was cleared or mistyped is
    // dropped without a word; the designer is told the import worked.
    it.fails(
      'Warns about rows with evidence but no recognised skill',
      async () => {
        const rows = fillTemplate('g7', UNICODE_EVIDENCE)
        rows[1] = ['Desing comms', ...rows[1].slice(1)]
        const { statusCode, result } = await upload({ file: toCsv(rows) })
        expect(statusCode).toBe(statusCodes.badRequest)
        expect(result).toContain('Desing comms')
      }
    )
  })

  describe('Problems the designer is told about', () => {
    async function expectError(options, message) {
      const { statusCode, result } = await upload(options)
      expect(statusCode).toBe(statusCodes.badRequest)
      expect(result).toContain('There is a problem')
      expect(result).toContain(message)
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
      return result
    }

    test('No file chosen', async () => {
      // Browsers send an empty, nameless file part when nothing is chosen
      await expectError(
        { file: '', fileName: '', contentType: 'application/octet-stream' },
        'Choose a CSV file to upload.'
      )
    })

    test('An empty file is currently reported as "Choose a CSV file"', async () => {
      await expectError({ file: '' }, 'Choose a CSV file to upload.')
    })

    test('A file of only spaces and blank lines', async () => {
      await expectError({ file: '  \r\n\r\n  ' }, 'The uploaded CSV is empty.')
    })

    test('A file with only blank rows and commas', async () => {
      await expectError(
        { file: ',,,,,\r\n,,,,,\r\n' },
        'Could not find any matching skills in this CSV template.'
      )
    })

    test('The scores export uploaded by mistake', async () => {
      await expectError(
        { file: readFixture('scores-export.csv') },
        'Could not find any matching skills in this CSV template.'
      )
    })

    test.each([
      ['text/csv'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']
    ])(
      'An Excel workbook instead of a CSV (sent as %s)',
      async (contentType) => {
        await expectError(
          { file: readFixture('workbook-renamed.xlsx.csv'), contentType },
          'Could not find any matching skills in this CSV template.'
        )
      }
    )

    test('A file a text editor broke (unescaped quote)', async () => {
      await expectError(
        { file: 'Iterative design,he said "hi",t,a,r,0' },
        'Could not parse this CSV. Use the reference template format and try again.'
      )
    })

    test('Evidence over 12,000 characters (labels included) rejects the whole file', async () => {
      const file = toCsv(
        fillTemplate('g7', {
          ...UNICODE_EVIDENCE,
          design_communication: { situation: 'x'.repeat(12000) }
        })
      )
      await expectError({ file }, 'is too long (max 12000 characters)')
    })

    test('Evidence of exactly 12,000 characters (labels included) is accepted', async () => {
      const situation = 'x'.repeat(12000 - 'Situation: '.length)
      const file = toCsv(
        fillTemplate('g7', { iterative_design: { situation } })
      )
      const { statusCode } = await upload({ file })
      expect(statusCode).toBe(302)
      expect(savedEvidence()[1].iterative_design).toHaveLength(12000)
    })

    // BUG (low): the message shows the internal key, e.g.
    // "design_communication", rather than "Design communication".
    it.fails('Names the over-long skill in plain English', async () => {
      const file = toCsv(
        fillTemplate('g7', {
          design_communication: { situation: 'x'.repeat(12000) }
        })
      )
      const result = await expectError({ file }, 'too long')
      expect(result).toContain('Design communication')
      expect(result).not.toContain('design_communication is too long')
    })

    test('A file over 2 MB gets an error page and saves nothing', async () => {
      const big = 'z'.repeat(2.1 * 1024 * 1024)
      const { statusCode, result } = await upload({
        file: toCsv(
          fillTemplate('g7', { iterative_design: { situation: big } })
        )
      })
      expect(statusCode).toBe(413)
      // The generic error page, not the import form with a message
      expect(result).toContain('Something went wrong')
      expect(result).not.toContain('Import GDaD evidence from CSV')
      expect(backendApi.saveGdadEvidence).not.toHaveBeenCalled()
    })

    // BUG (low): GOV.UK error pattern not fully followed — the summary
    // should link to the file input, the field should show the error
    // message itself, and the page title should start with "Error:".
    it.fails('Follows the GOV.UK error message pattern', async () => {
      const result = await expectError(
        { file: readFixture('scores-export.csv') },
        'Could not find any matching skills'
      )
      expect(result).toContain('href="#evidenceCsv"')
      expect(result).toContain('govuk-form-group--error')
      expect(result).toContain('govuk-error-message')
      expect(result).toMatch(/<title>\s*Error:/)
    })

    // BUG (low): GOV.UK wording for an empty file is "The selected file
    // is empty"; today it says "Choose a CSV file to upload."
    it.fails('Says the selected file is empty when it is', async () => {
      await expectError({ file: '' }, 'The selected file is empty')
    })
  })
})
