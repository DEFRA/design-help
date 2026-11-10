import { describe, expect, test } from 'vitest'
import nunjucks from 'nunjucks'

import { markdownToGovukHtml } from './markdown-to-govuk-html.js'

const render = (value) => String(markdownToGovukHtml(value)).trim()

describe('#markdownToGovukHtml', () => {
  test('Empty input returns an empty string', () => {
    expect(markdownToGovukHtml('')).toBe('')
    expect(markdownToGovukHtml('   ')).toBe('')
    expect(markdownToGovukHtml(null)).toBe('')
    expect(markdownToGovukHtml(undefined)).toBe('')
  })

  test('Paragraphs get the govuk-body class', () => {
    expect(render('Hello **there**')).toBe(
      '<p class="govuk-body">Hello <strong>there</strong></p>'
    )
  })

  test('Bullet lists get GOV.UK bullet list classes', () => {
    const html = render('- one\n- two')
    expect(html).toContain('<ul class="govuk-list govuk-list--bullet">')
    expect(html).toContain('<li>one</li>')
  })

  test('Numbered lists get GOV.UK numbered list classes', () => {
    expect(render('1. one\n2. two')).toContain(
      '<ol class="govuk-list govuk-list--number">'
    )
  })

  test('Links get govuk-link and a safe rel', () => {
    expect(render('[link](https://x.gov.uk)')).toBe(
      '<p class="govuk-body"><a href="https://x.gov.uk" class="govuk-link" rel="noreferrer noopener">link</a></p>'
    )
  })

  test('Code blocks get govuk-body and lose other classes', () => {
    const html = render('```js\nlet a = 1\n```')
    expect(html).toContain('<pre class="govuk-body"><code class="govuk-body">')
    expect(html).not.toContain('language-js')
  })

  test('Raw HTML and scripts are escaped, not rendered', () => {
    const html = render('<script>alert(1)</script> <b class="evil">x</b>')
    expect(html).not.toContain('<script')
    expect(html).not.toContain('<b')
    expect(html).toContain('&lt;script&gt;')
  })

  test('javascript: links are not turned into links', () => {
    const html = render('[click](javascript:alert(1))')
    expect(html).not.toContain('<a')
    expect(html).not.toContain('href')
  })

  test('User-supplied classes cannot get through', () => {
    const html = render(
      '<p class="evil">x</p>\n\n[a](https://x.gov.uk "t"){.evil}'
    )
    // The text may still show the escaped source, but no real tag carries it
    expect(html).not.toMatch(/<[a-z]+[^>]*class="[^"]*evil/)
    expect(html).toContain('&lt;p class="evil"&gt;')
  })

  test('Returns a SafeString so templates need no | safe', () => {
    expect(markdownToGovukHtml('x')).toBeInstanceOf(nunjucks.runtime.SafeString)
  })
})
