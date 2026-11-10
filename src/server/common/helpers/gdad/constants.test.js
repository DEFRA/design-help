import {
  SKILLS,
  getExpectedLevelKeyForSkillAndRole,
  getFrameworkRolePageLabel,
  getFrameworkTrackKeyForJobTitle,
  getGradedLevelForSkillScore,
  roleFrameworkPageUrl,
  skillFrameworkUrl
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

describe('#Framework links', () => {
  const base = 'https://understand-digital-data-roles-skills.service.gov.uk'

  test('Should link a service designer to their level on the service designer role page', () => {
    expect(roleFrameworkPageUrl('Principal Service Designer')).toBe(
      `${base}/role/service-designer/#lead-service-designer`
    )
    expect(roleFrameworkPageUrl('Senior Service Designer')).toBe(
      `${base}/role/service-designer/#senior-service-designer`
    )
    expect(roleFrameworkPageUrl('Head of Design')).toBe(
      `${base}/role/service-designer/#head-of-service-design`
    )
  })

  test('Should link an interaction designer to their level on the interaction designer role page', () => {
    expect(roleFrameworkPageUrl('Senior Interaction Designer')).toBe(
      `${base}/role/interaction-designer/#senior-interaction-designer`
    )
    expect(roleFrameworkPageUrl('Interaction Designer')).toBe(
      `${base}/role/interaction-designer/#interaction-designer`
    )
  })

  test('Should link to the role page without a level when the job title has no level', () => {
    expect(roleFrameworkPageUrl('Something Else')).toBe(
      `${base}/role/service-designer/`
    )
    expect(roleFrameworkPageUrl(undefined)).toBe(
      `${base}/role/service-designer/`
    )
  })

  test('Should link each skill to its section of the skills page', () => {
    expect(skillFrameworkUrl('design-communication')).toBe(
      `${base}/skills/#design-communication`
    )
  })
})
