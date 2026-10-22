# Migrating to format v3

Format v3 changes the shape of the generated data. This guide is for **consumers** of `data/dist/` and the manifest (the SCS IntelliSense extension and any other tool). Contributors editing `data/schemas/` only need [CONTRIBUTING.md](../CONTRIBUTING.md).

## Why

v2 was written from the SCS modding wiki alone, which turned out to be incomplete: attributes missing, some types guessed (the wiki only says "uint"), and families of attributes described without names. v3 takes the list of classes, attributes and types from the game itself, so every unit class of the game is covered (1,308 in ATS 1.61, against 8 in v2) and every type is the one the game uses.

## Where the files are

| | v2 (frozen) | v3 |
|---|---|---|
| Manifest | `data/manifest.json` | `data/manifest.v3.json` |
| Flattened class files | `data/dist/<class>.json` | `data/dist/v3/<class>.json` |
| `formatVersion` | `2.0.0` | `3.x` (currently `3.1.0`) |

**v2 is frozen, not removed.** Its files are no longer updated, but they stay in place and their CDN URLs keep working, so an extension version that reads v2 doesn't break. New data only goes to v3.

## What changed

### File names
Namespaced classes (`ui::text_common`) are stored with `::` written as `.`: `ui.text_common.json`. Always take the URL from the manifest entry instead of building it yourself.

### Class level
- `meta.documentationStatus` has a third value: `"undocumented"` (names and types only, no descriptions yet). Most classes start like this.
- `description` can be `""`.
- `dynamicAttributeGroups` is **removed**. It existed for attribute families the wiki didn't name; every attribute is now named individually in `key`.
- Manifest entries keep the same fields; `documentationStatus` can be `"undocumented"`.
- **3.1.0** adds `gameUnits` to each manifest entry: how many units of that class exist in SCS's own game files (`0` when never seen). Useful to rank class completion. The counts come from `data/game-usage.json`, which records the game version and the archives they were taken from; classes that live mostly in archives not counted there (e.g. truck DLCs) are undercounted. The field may be absent, so treat it as optional.

Within 3.x, changes only add optional fields, so a consumer can accept any `3.*`.

### Attribute level

| v2 | v3 |
|---|---|
| `type: string[] \| null` (list of possible types) | `type: string` — exactly **one** type name |
| `arrayElementType: string[] \| null` | **removed**: for arrays, `type` is the element type |
| `isArray` | unchanged |
| — | `status: "active" \| "legacy"` (new) |
| — | `default: string \| null` (new; v2 kept it inside `notes`) |
| `values` | also used for `type: "enum"` (the valid names) |
| everything else | unchanged |

Reading an attribute in v3:
- Scalar: `isArray: false`, value of type `type`.
- Array: `isArray: true`, each element of type `type`. Both array forms are valid for every array: repeated `key[]: value`, or `key: N` followed by `key[0]`..`key[N-1]`. (v2 needed `type` + `arrayElementType` to say "this one also accepts the count form"; v3 doesn't.)

### Types
The type names are the game's own (full list with syntax in `.vscode/db.schema.json`). Differences from v2:
- `quaternion` is now `quat`.
- New: `uint` and `int` (distinct from `u32`/`s32`), `enum`, `volatile_link_ptr`, `float4x4`, `uint2`, `placement_scale`, `placement_nonuniform`, `plane`, `sphere`, `aabox`.
- `enum`: the valid names are in `values`. `values` can be `null` when the names aren't known.

### Legacy attributes
`status: "legacy"` marks attributes the game still accepts but doesn't use (usually replaced by another one, e.g. `sound_horn` by `sounds`). Recommended handling: don't suggest them in completion, and don't report them as errors when found in a file.

## Suggested migration for a consumer
1. Read `data/manifest.v3.json` instead of `data/manifest.json`, and check `formatVersion` starts with `3.`.
2. Replace `def.isArray ? def.arrayElementType : def.type` with `def.type` (one string, not a list).
3. Rename `quaternion` to `quat` wherever types are matched or displayed.
4. Handle `status: "legacy"` and `documentationStatus: "undocumented"` (hide, or show a hint).
5. Show `default` in hovers, if useful.
6. Remove any use of `dynamicAttributeGroups`.
