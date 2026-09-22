import MarkdownIt from 'markdown-it'
import sanitizeHtml from 'sanitize-html'
import nunjucks from 'nunjucks'

const md = new MarkdownIt({ html: false, linkify: true, breaks: true })

const sanitizeOptions = {
  allowedTags: [
    'p',
    'br',
    'ul',
    'ol',
    'li',
    'a',
    'strong',
    'em',
    'code',
    'pre'
  ],
  allowedAttributes: { a: ['href', 'title'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  transformTags: {
    p: sanitizeHtml.simpleTransform('p', { class: 'govuk-body' }),
    ul: sanitizeHtml.simpleTransform('ul', {
      class: 'govuk-list govuk-list--bullet'
    }),
    ol: sanitizeHtml.simpleTransform('ol', {
      class: 'govuk-list govuk-list--number'
    }),
    pre: sanitizeHtml.simpleTransform('pre', { class: 'govuk-body' }),
    code: sanitizeHtml.simpleTransform('code', { class: 'govuk-body' }),
    a: sanitizeHtml.simpleTransform('a', {
      class: 'govuk-link',
      rel: 'noreferrer noopener'
    })
  }
}

/**
 * Renders user-written Markdown as sanitised, GOV.UK-classed HTML. Returns
 * a SafeString so templates do not need `| safe` after it.
 */
export function markdownToGovukHtml(value) {
  const text = String(value ?? '').trim()
  if (!text) {
    return ''
  }
  return new nunjucks.runtime.SafeString(
    sanitizeHtml(md.render(text), sanitizeOptions)
  )
}
