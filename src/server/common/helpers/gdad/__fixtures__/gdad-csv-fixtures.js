import path from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { parse } from 'csv-parse/sync'

import { buildGradeTemplateCsv } from '#/server/common/helpers/gdad/csv.js'

/*
 * Made-up evidence and helpers for the GDaD CSV import tests. Nothing here
 * is real data. The helpers imitate what a designer does: download a blank
 * template, fill in Situation/Task/Action/Result, save it from a
 * spreadsheet tool and upload it.
 */

const dirname = path.dirname(fileURLToPath(import.meta.url))

export const FIXTURE_DIR = path.join(dirname, 'csv')

export function readFixture(name) {
  return readFileSync(path.join(FIXTURE_DIR, name))
}

/**
 * Evidence covering the awkward content designers really write: commas,
 * double quotes, curly quotes, line breaks and blank lines inside a cell,
 * bullets, emoji, pound signs, accents, dashes and cells that a
 * spreadsheet would treat as formulas.
 */
export const UNICODE_EVIDENCE = {
  design_communication: {
    situation:
      'Our team’s “apply for a licence” service had a 40% drop-off, costing £1,200 a week.',
    task: 'Explain the problem to the board, the policy team, and the café owners who use it.',
    action:
      'I ran a show-and-tell:\n\n• walked through 3 journeys\n• played 2 clips\n\nThen I wrote a one-page summary.',
    result: 'The board said: "this is the clearest update we have had".'
  },
  designing_for_everyone: {
    situation:
      'Users with low vision – about 1 in 5 – could not finish the form.',
    task: 'Make the form work for everyone — including screen reader users.',
    action: '- Tested with 6 users\n- Fixed focus order\n- Re-tested',
    result: 'Completion went up 18 percentage points 🎉 👍🏽'
  },
  designing_strategically: {
    situation: '=SUM(A1:A3) is what the old spreadsheet tool showed users.',
    task: '+44 7700 900123 was the only support route.',
    action: '@policy-team and I mapped the whole service end to end.',
    result: '-30% calls to the helpline within 3 months.'
  },
  designing_together: {
    situation: 'Three teams, one service.',
    task: 'Agree one design approach.',
    action:
      'Ran weekly crits.\r\nUsed a shared Figma file.\r\n\r\nPaired with developers.',
    result: 'One pattern library, adopted by all three teams.'
  },
  evidence_based_design: {
    situation: 'Naïve assumptions about rural users’ broadband.',
    task: 'Find out what users actually had.',
    action: 'Survey (n=212), 14 interviews, and analytics.',
    result: 'We dropped the video upload step; résumé uploads now work offline.'
  },
  iterative_design: {
    situation: 'A prototype tested badly in round 1.',
    task: 'Improve it quickly.',
    action: 'Five rounds, each one a week apart; a “fail fast” mindset.',
    result: 'Task success went from 3/8 to 8/8.'
  },
  leading_design: {
    situation: 'A new junior designer joined.',
    task: 'Help them grow.',
    action: 'Weekly 1:1s, shadowing, and a learning plan.',
    result: 'They led their own user research session after 2 months.'
  }
}

/**
 * Evidence that only uses characters older “plain CSV” encodings
 * (Windows-1252 and Mac Roman) can store: no emoji.
 */
export const LEGACY_SAFE_EVIDENCE = {
  design_communication: {
    situation: 'The team’s “apply” page cost £1,200 a week.',
    task: 'Explain it to the café owners.',
    action: 'Show-and-tell – then a summary — with • bullets.',
    result: 'Résumé of findings agreed.'
  },
  designing_for_everyone: {
    situation: 'Plain situation',
    task: 'Plain task',
    action: 'Plain action',
    result: 'Plain result'
  }
}

/**
 * The parsed blank template for a grade with STAR text filled in for the
 * given skills. Skills with no entry stay blank, as they would if a
 * designer only filled in some rows.
 */
export function fillTemplate(gradeKey, evidenceBySkill) {
  const rows = parse(buildGradeTemplateCsv(gradeKey), {
    relax_column_count: true
  })
  const [header, ...skillRows] = rows
  const filled = skillRows.map((row) => {
    const key = skillKeyForTemplateRow(row)
    const parts = evidenceBySkill[key]
    if (!parts) {
      return row
    }
    return [
      row[0],
      parts.situation ?? '',
      parts.task ?? '',
      parts.action ?? '',
      parts.result ?? '',
      row[5]
    ]
  })
  return [header, ...filled]
}

const LABEL_TO_KEY = {
  'design communication': 'design_communication',
  'designing for everyone': 'designing_for_everyone',
  'designing strategically': 'designing_strategically',
  'designing together': 'designing_together',
  'evidence-based design': 'evidence_based_design',
  'iterative design': 'iterative_design',
  'leading design': 'leading_design'
}

export function skillKeyForTemplateRow(row) {
  return LABEL_TO_KEY[String(row[0]).split('\n')[0].trim().toLowerCase()]
}

/**
 * Serialise rows the way spreadsheet tools do: only quote a cell when it
 * holds the delimiter, a quote or a line break.
 */
export function toCsv(
  rows,
  { delimiter = ',', eol = '\r\n', bom = false, quoteAll = false } = {}
) {
  const escape = (value) => {
    const s = String(value ?? '')
    if (
      quoteAll ||
      s.includes('"') ||
      s.includes(delimiter) ||
      s.includes('\n') ||
      s.includes('\r')
    ) {
      return `"${s.replace(/"/g, '""')}"`
    }
    return s
  }
  const text = rows.map((row) => row.map(escape).join(delimiter)).join(eol)
  return (bom ? '﻿' : '') + text + eol
}

/** What the import should store for one skill’s STAR parts. */
export function expectedEvidence({ situation, task, action, result }) {
  return [
    situation && `Situation: ${situation.trim()}`,
    task && `Task: ${task.trim()}`,
    action && `Action: ${action.trim()}`,
    result && `Result: ${result.trim()}`
  ]
    .filter(Boolean)
    .join('\n\n')
}

const WINDOWS_1252 = {
  '€': 0x80,
  '‚': 0x82,
  '„': 0x84,
  '…': 0x85,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94
}

const MAC_ROMAN = {
  é: 0x8e,
  É: 0x83,
  ï: 0x95,
  '£': 0xa3,
  '•': 0xa5,
  '–': 0xd0,
  '—': 0xd1,
  '“': 0xd2,
  '”': 0xd3,
  '‘': 0xd4,
  '’': 0xd5
}

function encodeSingleByte(text, table, latin1Fallback) {
  const bytes = []
  for (const ch of text) {
    if (table[ch] !== undefined) {
      bytes.push(table[ch])
    } else if (ch.charCodeAt(0) < 0x80) {
      bytes.push(ch.charCodeAt(0))
    } else if (latin1Fallback && ch.charCodeAt(0) <= 0xff) {
      bytes.push(ch.charCodeAt(0))
    } else {
      throw new Error(`Cannot encode ${ch}`)
    }
  }
  return Buffer.from(bytes)
}

/** Bytes as Excel for Windows saves “CSV (Comma delimited)”. */
export function encodeWindows1252(text) {
  return encodeSingleByte(text, WINDOWS_1252, true)
}

/** Bytes as older Excel for Mac saves “Comma Separated Values”. */
export function encodeMacRoman(text) {
  return encodeSingleByte(text, MAC_ROMAN, false)
}
