import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true })

// Load JSON Schema
const schemaPath = path.resolve(process.cwd(), '.vscode/schema.json')
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
const validate = ajv.compile(schema)

// Load profanity dataset
const profanityFile = path.resolve(process.cwd(), 'data/dataset.jsonl')
const forbiddenMap = new Map()
fs.readFileSync(profanityFile, 'utf8')
  .split('\n')
  .forEach(line => {
    try {
      const obj = JSON.parse(line)
      if (obj.word) {
        const w = obj.word.toLowerCase()
        const severity = obj.severity ?? 0
        const safe = obj.safe_for_work ?? true
        if (!forbiddenMap.has(w) || forbiddenMap.get(w).severity < severity) {
          forbiddenMap.set(w, { word: w, severity, safe })
        }
      }
    } catch {}
  })

  const forbidden = Array.from(forbiddenMap.values())

// Profanity check
function escapeRegex(word) {
  return word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function checkForbidden(content, file) {
  const texts = []

  if ('description' in (content.meta || {})) {
    texts.push(content.meta.description ?? "")
  }
  if (content.key && typeof content.key === 'object') {
    for (const k of Object.keys(content.key)) {
      if ('description' in (content.key[k] || {})) {
        texts.push(content.key[k].description ?? "")
      }
    }
  }

  let hasError = false
  const reported = new Set() 

  for (const text of texts) {
    const lower = text.toLowerCase()
    for (const { word, severity, safe } of forbidden) {
      if (!word || word.length <= 3) continue
      if (safe) continue
      if (reported.has(word)) continue
      const regex = new RegExp(`\\b${escapeRegex(word)}\\b`, 'i')
      if (regex.test(lower)) {
        if (severity >= 4) {
          console.error(`❌ Error! Forbidden word detected!\nFile: ${file}\nWord: ${word}\nSeverity: ${severity}`)
          hasError = true
        } else if (severity === 3) {
          console.warn(`⚠️  Warning!\nFile: ${file}\nWord: ${word}\nSeverity: ${severity}`)
        }
        reported.add(word)
      }
    }
  }
  return !hasError
}

// Validate all schema files
const files = glob.sync('data/schemas/**/*.json')
let hasError = false

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))

  // Schema validation
  const valid = validate(data)
  if (!valid) {
    console.error(`❌ Invalid schema: ${file}`)
    for (const err of validate.errors) {
      console.error(`   - ${err.instancePath || '/'}: ${err.message}`)
    }
    hasError = true
    continue
  }

  // Profanity validation
  const clean = checkForbidden(data, file)
  if (!clean) {
    hasError = true
  }
}

if (hasError) {
  console.error('❌ Validation failed! Some schema files are invalid, or contain forbidden words.')
  process.exit(1)
} else {
  console.log('✅ All schema files are valid and clean!')
}
