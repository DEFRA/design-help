import { backendRecordsUpdatedBy, updatedByIdFor } from './evidence-edit.js'
import { buildSkillRows, skillNeedsScoring } from './helpers.js'
import { buildTeamRow, changedScores } from './review-controller.js'

/* The rules behind new evidence, without any pages. */

const SCORED_AT = '2026-09-15T09:00:00.000Z'

function entry(fields = {}) {
  return {
    evidenceText: 'Situation: scored',
    evidenceUpdatedAt: '2026-08-01T09:00:00.000Z',
    evidenceUpdatedById: null,
    officialScore: 2,
    scoredAt: SCORED_AT,
    newEvidenceText: null,
    newEvidenceUpdatedAt: null,
    newEvidenceUpdatedById: null,
    previous: [],
    ...fields
  }
}

const withNew = entry({
  newEvidenceText: 'Situation: next year',
  newEvidenceUpdatedAt: '2026-11-01T09:00:00.000Z'
})

describe('#backendRecordsUpdatedBy', () => {
  test('Yes when a skill entry has the evidenceUpdatedById key, even as null', () => {
    expect(backendRecordsUpdatedBy({ gdad: { leading_design: entry() } })).toBe(
      true
    )
  })

  test('No for the old backend’s entries, or no entries at all', () => {
    expect(
      backendRecordsUpdatedBy({
        gdad: { leading_design: { evidenceText: 'x', officialScore: 2 } }
      })
    ).toBe(false)
    expect(backendRecordsUpdatedBy({ gdad: {} })).toBe(false)
    expect(backendRecordsUpdatedBy({})).toBe(false)
  })

  test('updatedByIdFor gives the signed-in user only for the new backend', () => {
    const request = { app: { user: { id: 'u1' } } }
    expect(updatedByIdFor(request, { gdad: { leading_design: entry() } })).toBe(
      'u1'
    )
    expect(updatedByIdFor(request, { gdad: {} })).toBeUndefined()
  })
})

describe('#buildSkillRows new evidence', () => {
  const row = (gdadEntry) =>
    buildSkillRows({ leading_design: gdadEntry }, 'Interaction Designer').find(
      (s) => s.key === 'leading_design'
    )

  test('Scored with no new evidence: new evidence can be started', () => {
    const skill = row(entry())
    expect(skill.hasNewEvidence).toBe(false)
    expect(skill.canStartNewEvidence).toBe(true)
    expect(skill.needsScoring).toBe(false)
    expect(skill.scoredDateLabel).toBe('15 September 2026')
  })

  test('Not scored: new evidence cannot be started', () => {
    expect(row(entry({ officialScore: null })).canStartNewEvidence).toBe(false)
  })

  test('Old backend (no newEvidenceText key): never offered', () => {
    const skill = row({ evidenceText: 'x', officialScore: 2 })
    expect(skill.canStartNewEvidence).toBe(false)
    expect(skill.hasNewEvidence).toBe(false)
    expect(skill.previous).toEqual([])
  })

  test('New evidence needs a score, and the score choice starts blank', () => {
    const skill = row(withNew)
    expect(skill.hasNewEvidence).toBe(true)
    expect(skill.canStartNewEvidence).toBe(false)
    expect(skill.needsScoring).toBe(true)
    expect(skill.scoreSelectValue).toBeNull()
    expect(skill.blankScoreText).toBe('Not scored yet')
    expect(skill.officialScore).toBe(2)
  })

  test('skillNeedsScoring counts new evidence', () => {
    expect(
      skillNeedsScoring('x', 2, {
        evidenceUpdatedAt: null,
        scoredAt: SCORED_AT,
        hasNewEvidence: true
      })
    ).toBe(true)
  })
})

describe('#buildTeamRow new evidence', () => {
  test('Needs attention, and the last evidence date includes new evidence', () => {
    const team = buildTeamRow({
      id: 'p1',
      name: 'Made Up',
      role: 'Interaction Designer',
      gdad: { leading_design: withNew }
    })
    expect(team.needsAttention).toBe(true)
    expect(team.skillsNeedingScoring).toBe(1)
    expect(team.lastEvidenceLabel).toBe('1 Nov 2026, 09:00')
  })
})

describe('#changedScores new evidence', () => {
  const target = { gdad: { leading_design: withNew } }

  test('The same score counts as a change: it scores the new evidence', () => {
    expect(changedScores(target, { leading_design: 2 })).toEqual({
      leading_design: 2
    })
  })

  test('Blank leaves the current score alone', () => {
    expect(changedScores(target, { leading_design: null })).toEqual({})
  })

  test('Without new evidence, the same score is not a change', () => {
    expect(
      changedScores(
        { gdad: { leading_design: entry() } },
        { leading_design: 2 }
      )
    ).toEqual({})
  })
})
