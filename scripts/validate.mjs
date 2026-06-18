import fs from 'fs'
import path from 'path'
import { glob } from 'glob'
import Ajv from 'ajv'

const ajv = new Ajv({ allErrors: true })

// Resolve o caminho do schema relativo ao root do projeto
const schemaPath = path.resolve(process.cwd(), '.vscode/schema.json')
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
const validate = ajv.compile(schema)

const files = glob.sync('data/schemas/**/*.json')
let hasError = false

for (const file of files) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  const valid = validate(data)
  if (!valid) {
    console.error(`❌ Invalid schema: ${file}`)
    for (const err of validate.errors) {
      console.error(`   - ${err.instancePath || '/'}: ${err.message}`)
    }
    hasError = true
  }
}

if (hasError) {
  console.error('❌ Validation failed. Some schema files are invalid.')
  process.exit(1)
} else {
  console.log('✅ All schema files are valid!')
}
