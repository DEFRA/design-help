import Boom from '@hapi/boom'

import { buildGradeTemplateCsv } from '#/server/common/helpers/gdad/csv.js'

/**
 * Public reference downloads — `/gdad-reference/*` is on the auth
 * allow-list, so these handlers must not assume a signed-in user.
 */
export const gdadReferenceRoutes = [
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
