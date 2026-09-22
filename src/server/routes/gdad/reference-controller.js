import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import Boom from '@hapi/boom'

import { buildGradeTemplateCsv } from '#/server/common/helpers/gdad/csv.js'

const dirname = path.dirname(fileURLToPath(import.meta.url))
const SKILLS_MATRIX_PNG = path.resolve(
  dirname,
  '../../common/assets/gdad-skills-matrix.png'
)

let skillsMatrixBuffer

/**
 * Public reference downloads — `/gdad-reference/*` is on the auth
 * allow-list, so these handlers must not assume a signed-in user.
 */
export const gdadReferenceRoutes = [
  {
    method: 'GET',
    path: '/gdad-reference/skills-matrix.png',
    async handler(_request, h) {
      // Static route options point at .public, so serve the bundled asset
      // directly rather than through inert's file handler.
      skillsMatrixBuffer ??= await readFile(SKILLS_MATRIX_PNG)
      return h.response(skillsMatrixBuffer).type('image/png')
    }
  },
  {
    method: 'GET',
    path: '/gdad-reference/template-{grade}.csv',
    handler(request, h) {
      const gradeKey = String(request.params.grade ?? '')
        .trim()
        .toLowerCase()
      const csv = buildGradeTemplateCsv(gradeKey)
      if (!csv) {
        return Boom.notFound()
      }
      return h
        .response(csv)
        .type('text/csv')
        .header(
          'content-disposition',
          `attachment; filename="DDAT-GDaD-template-${gradeKey.toUpperCase()}.csv"`
        )
    }
  }
]
