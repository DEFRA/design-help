import { parse } from 'csv-parse/sync'

import {
  buildAdminExportCsv,
  buildGradeTemplateCsv,
  decodeCsvBuffer,
  decodeCsvUpload,
  parseGdadTemplateCsv
} from '#/server/common/helpers/gdad/csv.js'
import { SKILLS } from '#/server/common/helpers/gdad/constants.js'

describe('#parseGdadTemplateCsv', () => {
  test('Should join STAR columns and skip the header and unmatched rows', () => {
    const csv = [
      'SKILL,SITUATION,TASK,ACTION,RESULT,SCORES',
      'Iterative design,my situation,my task,my action,my result,0',
      'Not a real skill,a,b,c,d,0'
    ].join('\n')

    const { evidenceBySkill, importedSkillKeys } = parseGdadTemplateCsv(csv)

    expect(importedSkillKeys).toEqual(['iterative_design'])
    expect(evidenceBySkill.iterative_design).toBe(
      'Situation: my situation\n\nTask: my task\n\nAction: my action\n\nResult: my result'
    )
  })

  test('Should omit blank STAR parts and ignore the SCORES column', () => {
    const csv = 'Leading design,my situation,,,my result,3'

    const { evidenceBySkill } = parseGdadTemplateCsv(csv)

    expect(evidenceBySkill.leading_design).toBe(
      'Situation: my situation\n\nResult: my result'
    )
  })

  test('Should normalise ordinals, hyphens and packed skill cells', () => {
    const packedCell =
      '1) Evidence based design\n\nEXPERT (G6)\n\nBand description\n\nFramework: https://example.test'
    const csv = [
      `"${packedCell}",s1,t1,a1,r1,0`,
      '"evidence-based design",s2,t2,a2,r2,0',
      '"  2.   Designing   together  ",s3,t3,a3,r3,0'
    ].join('\n')

    const { evidenceBySkill, importedSkillKeys } = parseGdadTemplateCsv(csv)

    expect(importedSkillKeys.sort()).toEqual([
      'designing_together',
      'evidence_based_design'
    ])
    // Both spellings resolve to the same key; the later row overwrites
    expect(evidenceBySkill.evidence_based_design).toBe(
      'Situation: s2\n\nTask: t2\n\nAction: a2\n\nResult: r2'
    )
    expect(evidenceBySkill.designing_together).toBe(
      'Situation: s3\n\nTask: t3\n\nAction: a3\n\nResult: r3'
    )
  })

  test('Should let a later duplicate skill row overwrite an earlier one', () => {
    const csv = [
      'Design communication,first s,first t,first a,first r,0',
      'Design communication,second s,second t,second a,second r,0'
    ].join('\n')

    const { evidenceBySkill, importedSkillKeys } = parseGdadTemplateCsv(csv)

    expect(importedSkillKeys).toEqual(['design_communication'])
    expect(evidenceBySkill.design_communication).toBe(
      'Situation: second s\n\nTask: second t\n\nAction: second a\n\nResult: second r'
    )
  })

  test('Should fall back to semicolon and tab delimiters', () => {
    const semicolonCsv = '"Iterative design";"s";"t";"a";"r";"0"'
    expect(
      parseGdadTemplateCsv(semicolonCsv).evidenceBySkill.iterative_design
    ).toBe('Situation: s\n\nTask: t\n\nAction: a\n\nResult: r')

    const tabCsv = '"Leading design"\t"s"\t"t"\t"a"\t"r"\t"0"'
    expect(parseGdadTemplateCsv(tabCsv).evidenceBySkill.leading_design).toBe(
      'Situation: s\n\nTask: t\n\nAction: a\n\nResult: r'
    )
  })
})

describe('#decodeCsvBuffer', () => {
  test('Should decode UTF-8 buffers as-is', () => {
    const text = 'Iterative design,s,t,a,r,0'
    expect(decodeCsvBuffer(Buffer.from(text, 'utf8'))).toBe(text)
  })

  test('Should fall back to UTF-16LE when a UTF-8 decode leaves NULs', () => {
    const text = '\uFEFFDesigning together,s,t,a,r,0'
    const buffer = Buffer.from(text, 'utf16le')

    const decoded = decodeCsvBuffer(buffer)

    expect(decoded).not.toContain('\u0000')
    const { evidenceBySkill } = parseGdadTemplateCsv(decoded.trim())
    expect(evidenceBySkill.designing_together).toBe(
      'Situation: s\n\nTask: t\n\nAction: a\n\nResult: r'
    )
  })
})

describe('#decodeCsvUpload', () => {
  test('Should pass through a plain uploaded string', () => {
    const text = 'Iterative design,s,t,a,r,0'
    expect(decodeCsvUpload(text)).toBe(text)
  })

  test('Should decode an uploaded Buffer', () => {
    const text = 'Iterative design,s,t,a,r,0'
    expect(decodeCsvUpload(Buffer.from(text, 'utf8'))).toBe(text)
  })

  test('Should recover a UTF-16LE upload decoded to a NUL-ridden string', () => {
    const text = 'Designing together,s,t,a,r,0'
    // hapi decodes text/* parts as UTF-8; for UTF-16LE bytes that leaves
    // the ASCII characters interleaved with NULs
    const asUploadedString = Buffer.from(text, 'utf16le').toString('utf8')

    expect(decodeCsvUpload(asUploadedString)).toBe(text)
  })

  test('Should return null for a missing or empty file part', () => {
    expect(decodeCsvUpload(undefined)).toBeNull()
    expect(decodeCsvUpload({})).toBeNull()
  })
})

describe('#buildGradeTemplateCsv', () => {
  test('Should return null for an unknown grade', () => {
    expect(buildGradeTemplateCsv('g5')).toBeNull()
  })

  test('Should build the header and one packed row per skill', () => {
    const csv = buildGradeTemplateCsv('g6')
    const rows = parse(csv, { relax_column_count: true })

    expect(rows[0]).toEqual([
      'SKILL',
      'SITUATION',
      'TASK',
      'ACTION',
      'RESULT',
      'SCORES'
    ])
    expect(rows).toHaveLength(SKILLS.length + 1)

    const firstSkillCell = rows[1][0]
    // Principal Service Designer expects Expert for design communication
    expect(firstSkillCell).toContain('Design communication')
    expect(firstSkillCell).toContain('EXPERT (G6)')
    expect(firstSkillCell).toContain(
      'Framework: https://ddat-capability-framework.service.gov.uk/skills#design-communication'
    )
    expect(rows[1].slice(1)).toEqual(['', '', '', '', '0'])

    // Designing strategically is Practitioner on the G6 track
    const strategicallyRow = rows.find((row) =>
      String(row[0]).startsWith('Designing strategically')
    )
    expect(strategicallyRow[0]).toContain('PRACTITIONER (G6)')
  })

  test('Should map grades to the expected roles and bands', () => {
    const seoRows = parse(buildGradeTemplateCsv('seo'), {
      relax_column_count: true
    })
    expect(seoRows[1][0]).toContain('WORKING (SEO)')

    const g7Rows = parse(buildGradeTemplateCsv('g7'), {
      relax_column_count: true
    })
    expect(g7Rows[1][0]).toContain('PRACTITIONER (G7)')
    // Leading design stays Working at G7
    const g7Leading = g7Rows.find((row) =>
      String(row[0]).startsWith('Leading design')
    )
    expect(g7Leading[0]).toContain('WORKING (G7)')
  })

  test('Should round-trip: a filled-in template imports every skill', () => {
    const rows = parse(buildGradeTemplateCsv('g6'), {
      relax_column_count: true
    })
    const filled = rows
      .slice(1)
      .map((row) => `"${String(row[0]).replace(/"/g, '""')}",s,t,a,r,0`)
      .join('\n')

    const { importedSkillKeys } = parseGdadTemplateCsv(filled)
    expect(importedSkillKeys.sort()).toEqual(
      SKILLS.map((skill) => skill.key).sort()
    )
  })
})

describe('#buildAdminExportCsv', () => {
  const fullScores = {
    design_communication: 3,
    designing_for_everyone: 3,
    designing_strategically: 3,
    designing_together: 2,
    evidence_based_design: 2,
    iterative_design: 3,
    leading_design: 3
  }

  test('Should match the reference export header exactly', () => {
    const csv = buildAdminExportCsv([])
    expect(csv).toBe(
      'Name,Role,Grade,Design communication - E,Designing for everyone - E,Designing strategically - P,Designing together - E,Evidence based design - E,Iterative design - E,Leading design - P,Total,Capability Level,Score Change,Capability Level Change'
    )
  })

  test('Should export Principal Service Designer as Lead Service Designer at G6 with best-six total', () => {
    const csv = buildAdminExportCsv([
      { name: 'Test Person', role: 'Principal Service Designer', ...fullScores }
    ])
    const line = csv.split('\n')[1]

    // Best six of [3,3,3,2,2,3,3] is 17 → Accomplished Level 1 (level 5)
    expect(line).toBe(
      'Test Person,Lead Service Designer,G6,3,3,3,2,2,3,3,17,5,,'
    )
  })

  test('Should leave scores, total and capability level blank when unscored', () => {
    const csv = buildAdminExportCsv([
      {
        name: 'No Scores',
        role: 'Senior Service Designer',
        design_communication: null,
        designing_for_everyone: null,
        designing_strategically: null,
        designing_together: null,
        evidence_based_design: null,
        iterative_design: null,
        leading_design: null
      }
    ])
    expect(csv.split('\n')[1]).toBe(
      'No Scores,Senior Service Designer,G7,,,,,,,,,,,'
    )
  })

  test('Should compute a total from six scores but leave it blank below six', () => {
    const sixScores = { ...fullScores, leading_design: null }
    const csvSix = buildAdminExportCsv([
      { name: 'Six', role: 'Service Designer', ...sixScores }
    ])
    // [3,3,3,2,2,3] totals 16 → Accomplished Level 1 (level 5)
    expect(csvSix.split('\n')[1]).toBe(
      'Six,Service Designer,SEO,3,3,3,2,2,3,,16,5,,'
    )

    const fiveScores = { ...sixScores, iterative_design: null }
    const csvFive = buildAdminExportCsv([
      { name: 'Five', role: 'Interaction Designer', ...fiveScores }
    ])
    expect(csvFive.split('\n')[1]).toBe(
      'Five,Interaction Designer,SEO,3,3,3,2,2,,,,,,'
    )
  })

  test('Should escape names containing commas or quotes', () => {
    const csv = buildAdminExportCsv([
      {
        name: 'Surname, "Nickname" First',
        role: 'Design Manager',
        design_communication: null,
        designing_for_everyone: null,
        designing_strategically: null,
        designing_together: null,
        evidence_based_design: null,
        iterative_design: null,
        leading_design: null
      }
    ])
    expect(csv.split('\n')[1]).toBe(
      '"Surname, ""Nickname"" First",Design Manager,G6,,,,,,,,,,,'
    )
  })
})
