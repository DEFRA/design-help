import {
  SKILLS,
  getExpectedLevelKeyForSkillAndRole,
  getFrameworkRolePageLabel,
  getFrameworkTrackKeyForJobTitle,
  getGradedLevelForSkillScore
} from '#/server/common/helpers/gdad/constants.js'

describe('#Design Manager grade', () => {
  test('Should map Design Manager to the senior service designer (G7) track', () => {
    expect(getFrameworkTrackKeyForJobTitle('Design Manager')).toBe(
      'senior_service_designer'
    )
    expect(getFrameworkRolePageLabel('Design Manager')).toBe(
      'Senior service designer'
    )
  })

  test('Should give Design Manager the same expected levels as a Senior Service Designer', () => {
    for (const skill of SKILLS) {
      expect(
        getExpectedLevelKeyForSkillAndRole(skill.key, 'Design Manager')
      ).toBe(
        getExpectedLevelKeyForSkillAndRole(skill.key, 'Senior Service Designer')
      )
    }
    expect(
      getExpectedLevelKeyForSkillAndRole(
        'evidence_based_design',
        'Design Manager'
      )
    ).toBe('practitioner')
    expect(
      getExpectedLevelKeyForSkillAndRole('leading_design', 'Design Manager')
    ).toBe('working')
  })

  test('Should grade an above-standard Design Manager one band above practitioner, not Expert +', () => {
    expect(
      getGradedLevelForSkillScore('evidence_based_design', 'Design Manager', 3)
    ).toMatchObject({ label: 'Expert' })
  })

  test('Should keep Principal Service Designer on the lead (G6) track', () => {
    expect(getFrameworkTrackKeyForJobTitle('Principal Service Designer')).toBe(
      'lead_service_designer'
    )
    expect(getFrameworkTrackKeyForJobTitle('Head of Design')).toBe(
      'head_of_service_design'
    )
  })
})
