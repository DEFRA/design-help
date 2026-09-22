import {
  createAll,
  Button,
  Checkboxes,
  ErrorSummary,
  Radios,
  SkipLink
} from 'govuk-frontend'

createAll(Button)
createAll(Checkboxes)
createAll(ErrorSummary)
createAll(Radios)
createAll(SkipLink)

// "Who I'm helping": add another helpee row (max 25), ported from the
// prototype's application.js
const addHelpingBtn = document.getElementById('add-helping-row')
const helpingTemplate = document.getElementById('helping-row-template')
const helpingContainer = document.getElementById('helping-rows')
if (addHelpingBtn && helpingTemplate && helpingContainer) {
  const maxHelpingRows = 25
  const rowCount = () =>
    helpingContainer.querySelectorAll('[data-helping-row]').length
  if (rowCount() >= maxHelpingRows) {
    addHelpingBtn.hidden = true
  }
  addHelpingBtn.addEventListener('click', () => {
    if (rowCount() >= maxHelpingRows) {
      return
    }
    const row = helpingTemplate.content.cloneNode(true)
    helpingContainer.appendChild(row)
    if (rowCount() >= maxHelpingRows) {
      addHelpingBtn.hidden = true
    }
  })
}
