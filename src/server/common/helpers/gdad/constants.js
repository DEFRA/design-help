/**
 * GDaD / DDaT design skills — seven skills aligned with the Government
 * Digital and Data Profession Capability Framework
 * (https://ddat-capability-framework.service.gov.uk/).
 */

export const FRAMEWORK_BASE = 'https://ddat-capability-framework.service.gov.uk'
export const SKILLS_PATH = `${FRAMEWORK_BASE}/skills`

/** Job titles in this app that are not on the GDaD design skills path yet */
const NON_GDAD_ROLES = new Set([
  'Accessibility Specialist (SEO)',
  'Senior Accessibility Specialist (Grade 7)',
  'Resource Manager',
  'Senior Resource Manager'
])

export function isAccessibilityOnlyRole(role) {
  if (!role) {
    return false
  }
  return NON_GDAD_ROLES.has(String(role).trim())
}

/** True when this job title should see GDaD evidence features (must still have a profile). */
export function isGdadEvidenceApplicableRole(role) {
  if (!role || !String(role).trim()) {
    return false
  }
  return !isAccessibilityOnlyRole(role)
}

/**
 * Three bands (aligned with DDaT Working / Practitioner / Expert). Short
 * summaries — full wording is on the framework site.
 */
export const LEVEL_BANDS = [
  {
    key: 'working',
    label: 'Working',
    tagClass: 'govuk-tag--blue',
    description:
      'Typical expectations at junior to mid grades (for example SEO). Align your STAR evidence to behaviours at this band unless your role profile points higher.'
  },
  {
    key: 'practitioner',
    label: 'Practitioner',
    tagClass: 'govuk-tag--yellow',
    description:
      'Typical expectations at senior grades (for example G7). Demonstrate broader influence and complexity than “working”.'
  },
  {
    key: 'expert',
    label: 'Expert',
    tagClass: 'govuk-tag--green',
    description:
      'Typical expectations at lead grades (for example G6). Organisation-wide or strategic impact.'
  }
]

const ROLE_TO_FRAMEWORK_TRACK = {
  'Interaction Designer': 'interaction_designer',
  'Service Designer': 'service_designer',
  'Senior Interaction Designer': 'senior_interaction_designer',
  'Senior Service Designer': 'senior_service_designer',
  'Principal Service Designer': 'lead_service_designer',
  'Design Manager': 'lead_service_designer',
  'Senior Resource Manager': 'lead_service_designer',
  'Head of Design': 'head_of_service_design'
}

const FRAMEWORK_TRACK_LABEL = {
  service_designer: 'Service designer',
  senior_service_designer: 'Senior service designer',
  lead_service_designer: 'Lead service designer',
  head_of_service_design: 'Head of service design',
  interaction_designer: 'Interaction designer',
  senior_interaction_designer: 'Senior interaction designer',
  lead_interaction_designer: 'Lead interaction designer',
  head_of_interaction_design: 'Head of interaction design'
}

/**
 * Per-skill expected level from the service designer role tables. The
 * interaction designer role tables use the same pattern — alias tracks
 * point at the same objects.
 */
const FRAMEWORK_TRACK_SKILL_LEVELS = {
  service_designer: {
    design_communication: 'working',
    designing_for_everyone: 'working',
    designing_strategically: 'working',
    designing_together: 'working',
    evidence_based_design: 'working',
    iterative_design: 'working',
    leading_design: 'working'
  },
  senior_service_designer: {
    design_communication: 'practitioner',
    designing_for_everyone: 'practitioner',
    designing_strategically: 'practitioner',
    designing_together: 'practitioner',
    evidence_based_design: 'practitioner',
    iterative_design: 'practitioner',
    leading_design: 'working'
  },
  lead_service_designer: {
    design_communication: 'expert',
    designing_for_everyone: 'expert',
    designing_strategically: 'practitioner',
    designing_together: 'expert',
    evidence_based_design: 'expert',
    iterative_design: 'expert',
    leading_design: 'practitioner'
  },
  head_of_service_design: {
    design_communication: 'expert',
    designing_for_everyone: 'expert',
    designing_strategically: 'expert',
    designing_together: 'expert',
    evidence_based_design: 'expert',
    iterative_design: 'expert',
    leading_design: 'expert'
  }
}

FRAMEWORK_TRACK_SKILL_LEVELS.interaction_designer =
  FRAMEWORK_TRACK_SKILL_LEVELS.service_designer
FRAMEWORK_TRACK_SKILL_LEVELS.senior_interaction_designer =
  FRAMEWORK_TRACK_SKILL_LEVELS.senior_service_designer
FRAMEWORK_TRACK_SKILL_LEVELS.lead_interaction_designer =
  FRAMEWORK_TRACK_SKILL_LEVELS.lead_service_designer
FRAMEWORK_TRACK_SKILL_LEVELS.head_of_interaction_design =
  FRAMEWORK_TRACK_SKILL_LEVELS.head_of_service_design

/** Profile job titles whose framework role page is interaction-designer (others default to service-designer). */
const JOB_TITLES_INTERACTION_DESIGNER_ROLE_PAGE = new Set([
  'Interaction Designer',
  'Senior Interaction Designer'
])

/** Served by app — local copy of team matrix PNG; canonical levels are from the framework role page. */
export const GDAD_SKILLS_MATRIX_URL = '/gdad-reference/skills-matrix.png'

export function getFrameworkTrackKeyForJobTitle(role) {
  if (!role) {
    return 'service_designer'
  }
  return ROLE_TO_FRAMEWORK_TRACK[String(role).trim()] || 'service_designer'
}

/** Human-readable DDaT role level label (interaction or service pathway), for UI copy. */
export function getFrameworkRolePageLabel(role) {
  const track = getFrameworkTrackKeyForJobTitle(role)
  return FRAMEWORK_TRACK_LABEL[track] || FRAMEWORK_TRACK_LABEL.service_designer
}

/** Full URL to the relevant DDaT “role” page (interaction vs service designer pathway). */
export function roleFrameworkPageUrl(profileRole) {
  if (
    profileRole &&
    JOB_TITLES_INTERACTION_DESIGNER_ROLE_PAGE.has(String(profileRole).trim())
  ) {
    return `${FRAMEWORK_BASE}/role/interaction-designer`
  }
  return `${FRAMEWORK_BASE}/role/service-designer`
}

export function getExpectedLevelKeyForSkillAndRole(skillKey, role) {
  const track = getFrameworkTrackKeyForJobTitle(role)
  const matrix = FRAMEWORK_TRACK_SKILL_LEVELS[track]
  return matrix?.[skillKey] || 'working'
}

export function getExpectedBandForSkillAndRole(skillKey, role) {
  const levelKey = getExpectedLevelKeyForSkillAndRole(skillKey, role)
  return LEVEL_BANDS.find((band) => band.key === levelKey) || LEVEL_BANDS[0]
}

/**
 * Seven skills — keys match the backend skill keys; frameworkHash is the
 * on-page anchor on /skills.
 */
export const SKILLS = [
  {
    key: 'design_communication',
    label: 'Design communication',
    frameworkHash: 'design-communication',
    starHint:
      'Situation, task, action, result — focus on how you communicated design decisions and to whom.'
  },
  {
    key: 'designing_for_everyone',
    label: 'Designing for everyone',
    frameworkHash: 'designing-for-everyone',
    starHint:
      'Inclusive, accessible and sustainable design — evidence of how you met user needs and standards.'
  },
  {
    key: 'designing_strategically',
    label: 'Designing strategically',
    frameworkHash: 'designing-strategically',
    starHint:
      'How your work aligned to team and organisational goals, risks, opportunities, patterns or components.'
  },
  {
    key: 'designing_together',
    label: 'Designing together',
    frameworkHash: 'designing-together',
    starHint:
      'Sessions, stakeholders, feedback, and collaboration across boundaries.'
  },
  {
    key: 'evidence_based_design',
    label: 'Evidence-based design',
    frameworkHash: 'evidence-based-design',
    starHint:
      'Hypotheses, research, analytics or data you used to develop and test design ideas.'
  },
  {
    key: 'iterative_design',
    label: 'Iterative design',
    frameworkHash: 'iterative-design',
    starHint:
      'Agile iteration, prototyping fidelity, patterns, and responding to change.'
  },
  {
    key: 'leading_design',
    label: 'Leading design',
    frameworkHash: 'leading-design',
    starHint:
      'Leading, coordinating, mentoring, or influencing design practice and leadership.'
  }
]

export const SKILL_KEY_SET = new Set(SKILLS.map((skill) => skill.key))

export const MAX_EVIDENCE_LENGTH = 12000

export const SCORE_LABELS = {
  1: 'Below standard',
  2: 'At standard',
  3: 'Above standard'
}

/**
 * Capability banding rules supplied for six scored skills (best six from
 * seven total skills). Total is the sum of six official scores in {1,2,3},
 * so the range is 6..18.
 */
export const CAPABILITY_BANDS = [
  { level: 1, rating: 'Developing', minTotal: 6, maxTotal: 8 },
  { level: 2, rating: 'Proficient Level 1', minTotal: 9, maxTotal: 11 },
  { level: 3, rating: 'Proficient Level 2', minTotal: 12, maxTotal: 13 },
  { level: 4, rating: 'Proficient Level 3', minTotal: 14, maxTotal: 15 },
  { level: 5, rating: 'Accomplished Level 1', minTotal: 16, maxTotal: 17 },
  { level: 6, rating: 'Accomplished Level 2', minTotal: 18, maxTotal: 18 }
]

/**
 * Official score relative to this skill’s expected band: 1 → one band below
 * expected, 2 → at expected, 3 → one band above.
 */
export function getGradedLevelForSkillScore(skillKey, role, officialScore) {
  if (
    officialScore == null ||
    officialScore === '' ||
    Number.isNaN(Number(officialScore))
  ) {
    return null
  }
  const score = Number(officialScore)
  if (score !== 1 && score !== 2 && score !== 3) {
    return null
  }

  const expectedBand = getExpectedBandForSkillAndRole(skillKey, role)
  const trackKey = getFrameworkTrackKeyForJobTitle(role)
  const isG6Track =
    trackKey === 'lead_service_designer' ||
    trackKey === 'lead_interaction_designer'
  const idx = LEVEL_BANDS.findIndex((band) => band.key === expectedBand.key)
  const safeIdx = idx === -1 ? 0 : idx

  if (score === 2) {
    return {
      label: expectedBand.label,
      tagClass: expectedBand.tagClass,
      summary: 'At your expected level for this skill'
    }
  }
  if (score === 1) {
    if (safeIdx <= 0) {
      return {
        label: 'Awareness',
        tagClass: 'govuk-tag--grey',
        summary: 'Below your expected level for this skill'
      }
    }
    const band = LEVEL_BANDS[safeIdx - 1]
    return {
      label: band.label,
      tagClass: band.tagClass,
      summary: 'One band below your expected level for this skill'
    }
  }
  if (safeIdx >= LEVEL_BANDS.length - 1) {
    if (isG6Track && expectedBand.key === 'expert') {
      return {
        label: 'Expert +',
        tagClass: 'govuk-tag--green',
        summary: 'Above your expected level for this skill'
      }
    }
    return {
      label: 'Expert',
      tagClass: 'govuk-tag--green',
      summary: 'At the top available level for this skill'
    }
  }
  const band = LEVEL_BANDS[safeIdx + 1]
  return {
    label: band.label,
    tagClass: band.tagClass,
    summary: 'One band above your expected level for this skill'
  }
}

/**
 * Uses a designer's best six official scores (from up to seven skills) to
 * compute their capability band. Not ready until at least six scores exist.
 */
export function getCapabilityBandFromScores(officialScores) {
  const validScores = (officialScores || [])
    .map((score) => Number(score))
    .filter((score) => score === 1 || score === 2 || score === 3)
    .sort((a, b) => b - a)

  if (validScores.length < 6) {
    return {
      ready: false,
      scoredSkillsCount: validScores.length
    }
  }

  const bestSix = validScores.slice(0, 6)
  const total = bestSix.reduce((sum, score) => sum + score, 0)
  const matchedBand =
    CAPABILITY_BANDS.find(
      (band) => total >= band.minTotal && total <= band.maxTotal
    ) || null

  return {
    ready: true,
    scoredSkillsCount: validScores.length,
    bestSix,
    total,
    average: total / 6,
    band: matchedBand
  }
}

export function skillFrameworkUrl(frameworkHash) {
  return `${SKILLS_PATH}#${frameworkHash}`
}
