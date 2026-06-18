#!/usr/bin/env node
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { glob } from 'glob';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SCHEMAS_GLOB = 'data/schemas/**/*.json';

const ROOT_ORDER = ['meta', 'scope', 'key'];
const KEY_FIELD_ORDER = ['description', 'type', 'isArray', 'arrayElementType'];

const TYPE_PRIORITY = [
  'string','float','float2','float3','float4','placement',
  'fixed','fixed2','fixed3','fixed4','int2','quaternion',
  's16','s32','s64','u16','u32','u64','bool','token',
  'owner_ptr','link_ptr','resource_tie'
];

const TYPE_PRIORITY_MAP = TYPE_PRIORITY.reduce((m, v, i) => (m.set(v, i), m), new Map());

function orderObject(obj, desiredOrder = []) {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return obj;
  const out = {};
  for (const k of desiredOrder) {
    if (Object.prototype.hasOwnProperty.call(obj, k)) {
      out[k] = obj[k];
    }
  }
  for (const k of Object.keys(obj)) {
    if (!desiredOrder.includes(k)) out[k] = obj[k];
  }
  return out;
}

function normalizeToArray(val) {
  if (val === null || val === undefined) return val;
  if (Array.isArray(val)) return val.slice();
  return [String(val)];
}

function sortTypeArray(arr) {
  if (!Array.isArray(arr)) return arr;
  const withIndex = arr.map((v, idx) => ({ v, idx }));
  withIndex.sort((a, b) => {
    const pa = TYPE_PRIORITY_MAP.has(a.v) ? TYPE_PRIORITY_MAP.get(a.v) : Infinity;
    const pb = TYPE_PRIORITY_MAP.has(b.v) ? TYPE_PRIORITY_MAP.get(b.v) : Infinity;
    if (pa !== pb) return pa - pb;
    return a.idx - b.idx;
  });
  return withIndex.map(x => x.v);
}

function reorderSchema(schema) {
  let ordered = orderObject(schema, ROOT_ORDER);

  if (ordered.key && typeof ordered.key === 'object' && !Array.isArray(ordered.key)) {
    const newKey = {};
    for (const fieldName of Object.keys(ordered.key)) {
      const field = ordered.key[fieldName];
      if (field && typeof field === 'object' && !Array.isArray(field)) {
        let orderedField = orderObject(field, KEY_FIELD_ORDER);

        if (Object.prototype.hasOwnProperty.call(orderedField, 'type')) {
          if (orderedField.type === null || orderedField.type === undefined) {
            orderedField.type = null
          } else {
            const t = normalizeToArray(orderedField.type);
            orderedField.type = sortTypeArray(t);
          }
        }

        if (Object.prototype.hasOwnProperty.call(orderedField, 'arrayElementType')) {
          const a = normalizeToArray(orderedField.arrayElementType);
          const sortedA = sortTypeArray(a);
          if (Array.isArray(field.arrayElementType)) {
            orderedField.arrayElementType = sortedA;
          } else if (field.arrayElementType === null || field.arrayElementType === undefined) {
            orderedField.arrayElementType = field.arrayElementType;
          } else {
            orderedField.arrayElementType = sortedA.length > 0 ? sortedA[0] : field.arrayElementType;
          }
        }

        newKey[fieldName] = orderedField;
      } else {
        newKey[fieldName] = field;
      }
    }
    ordered.key = newKey;
  }

  return ordered;
}

async function processFile(filePath) {
  const abs = path.resolve(__dirname, '..', filePath);
  const raw = await fs.readFile(abs, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Skipping ${filePath} - invalid JSON: ${err.message}`);
    return false;
  }

  const reordered = reorderSchema(parsed);
  const out = JSON.stringify(reordered, null, 2) + '\n';

  if (out !== raw) {
    await fs.writeFile(abs, out, 'utf8');
    console.log(`Formatted ${filePath}`);
    return true;
  } else {
    console.log(`No changes for ${filePath}`);
    return false;
  }
}

async function main() {
  const files = glob.sync(SCHEMAS_GLOB, { nodir: true });
  console.log(`Found ${files.length} files`);
  if (files.length === 0) {
    console.log('No schema files found');
    return;
  }

  let changedAny = false;
  for (const f of files) {
    try {
      const changed = await processFile(f);
      if (changed) changedAny = true;
    } catch (err) {
      console.error(`Error processing ${f}: ${err.stack || err}`);
    }
  }

  if (changedAny) {
    console.log('Some files were reformatted. Commit the changes or fail CI as desired.');
    process.exitCode = 0;
  } else {
    console.log('All schemas already formatted.');
    process.exitCode = 0;
  }
}

main().catch(err => {
  console.error(err);
  process.exit(2);
});
