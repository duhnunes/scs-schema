// Shared between build.mjs (which needs the resolved chain to flatten
// `key` maps) and validate.mjs (which just needs to catch a bad
// `superclass` or a cycle early, at commit time, instead of only when
// build.mjs runs in CI). Kept in one place so the two never quietly
// diverge on what counts as valid inheritance.

// The engine's own generic base type (confirmed via package_version_info's
// "Raw Unit Definition" section, which shows `"superclass": "unit"` even
// for classes with no documented parent) — not a real ancestor to resolve.
export const ROOT_SUPERCLASS = 'unit'

/**
 * Resolves the full ancestor chain for a class, root-first — e.g.
 * ["accessory_data", "accessory_addon_data"] for
 * accessory_horn_addon_data, whose direct parent is accessory_addon_data
 * and whose grandparent is accessory_data. Throws on a superclass that
 * doesn't match any known scope (likely a typo) or on a cycle.
 *
 * `schemas` is a Map of scope -> parsed schema object (see
 * loadSourceSchemas() in build.mjs / validate.mjs).
 */
export function resolveAncestorChain(scope, schemas) {
  const chain = []
  const visited = new Set([scope])
  let current = schemas.get(scope)

  while (current.superclass && current.superclass !== ROOT_SUPERCLASS) {
    const parentScope = current.superclass

    if (visited.has(parentScope)) {
      throw new Error(
        `Circular inheritance involving "${scope}" (via superclass "${parentScope}")`
      )
    }

    const parent = schemas.get(parentScope)
    if (!parent) {
      throw new Error(
        `"${scope}" declares superclass "${parentScope}", but no schema file defines that scope`
      )
    }

    visited.add(parentScope)
    chain.unshift(parentScope)
    current = parent
  }

  return chain
}
