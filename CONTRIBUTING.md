# Contributing to SCS Schemas Database

Thanks for helping improve the schema database used by the <a href="https://github.com/duhnunes/scs-intellisense">SCS IntelliSense</a> VSCode extension. This document explains how to add or edit JSON schema files under `data/schemas/`. This guide is only for contributions that add or edit `.json` files inside `data/schemas/`.

---

## Table of Contents
- [Quick Rules (must follow)](#quick-rules-must-follow)
- [File location](#file-location)
- [File format and field rules](#file-format-and-field-rules)
  - [Class-level fields](#class-level-fields)
  - [Attribute fields (inside `key`)](#attribute-fields-inside-key)
  - [`dynamicAttributeGroups`](#dynamicattributegroups)
- [How to decide what to fill in](#how-to-decide-what-to-fill-in)
- [Examples](#examples)
- [Validation](#validation)
- [PR workflow](#pr-workflow)
- [Checklist before PR](#checklist-before-pr)
- [Automated PR workflow](#automated-pr-workflow)

## Quick rules (must follow)
- **Filename**: must equal the `class_name`, e.g. `accessory_data.json`.
- **`scope`**: must equal the filename (without `.json`) and the `class_name`.
- **Required top-level fields**: `meta`, `scope`, `description`, `superclass`, `allowsSiiNunitRoot`, `key`.
- **Versioning**: a new file always starts at `meta.version: "0.1.0"` — the automation bumps it for you afterwards, never edit it by hand again.
- **Only document what the wiki page for that exact class actually says.** If a field isn't confirmed by the specific page you're reading, leave it `null`/`false` — see [How to decide what to fill in](#how-to-decide-what-to-fill-in).
- **Never copy in inherited attributes.** `key` only lists attributes this class adds itself — see [`superclass`](#class-level-fields).

## File location

**Files are flat — there is no folder structure to mirror.** Every schema lives directly under `data/schemas/`, named after its `class_name`:

```
data/schemas/
  accessory_data.json
  accessory_addon_data.json
  accessory_horn_addon_data.json
  ...
```

This changed from an earlier version of this guide that mirrored the game's own folder layout (`/def/world/...`). That stopped making sense once classes can inherit from each other — a class like `accessory_data` isn't "used" from any one game folder, so there's no single path to mirror. The extension never looks at file paths anyway; it only ever reads `manifest.json`, which is what actually maps a `class_name` to its data.

## File format and field rules

### Class-level fields

| Field | Required | Notes |
|---|---|---|
| `meta.version` | Yes | Semver, always `"0.1.0"` on a new file. Bumped automatically afterwards — don't touch it again. |
| `meta.documentationStatus` | Yes | `"wip"` if the wiki page itself shows the *"This article is a work in progress and has yet to be reviewed by SCS staff"* notice near the top. `"complete"` otherwise. |
| `scope` | Yes | The `class_name`. Must match the filename. |
| `description` | Yes | A sentence or two summarizing the class — usually close to the wiki page's own opening paragraph. |
| `superclass` | Yes | The **direct** parent class only — never the whole ancestor chain, `scripts/build.mjs` resolves that recursively. Use the literal value `"unit"` when the class has no real documented parent (the engine's own generic root type). |
| `versionNote` | Optional | Free-text, exactly as the wiki phrases it (e.g. `"Added in 1.38."`, `"Removed in 1.44 (ETS2 only)."`). `null` when there's nothing noteworthy. Deliberately one free-text field, not separate `addedIn`/`removedIn` — the wiki isn't consistent enough (sometimes one version, sometimes different per game, sometimes a whole sentence) to force into stricter structure, and the extension never knows what game version the user has, so this is purely informational. |
| `allowsSiiNunitRoot` | Yes | `false` **only** if the wiki explicitly says the class must not be used as a file's `SiiNunit` root (e.g. it says something like *"must not use the SiiNunit magic mark"* — these classes only ever appear via `@include`). `true` for everything else, including when the page says nothing about it at all. |
| `key` | Yes | This class's **own** attributes only. Do not copy in anything inherited from `superclass` — `scripts/build.mjs` merges those in automatically when generating `data/dist/`. |
| `dynamicAttributeGroups` | Optional | See its own section below. `[]` when not applicable. |

### Attribute fields (inside `key`)

Every attribute needs **all** of these fields present (not optional at the JSON Schema level), even when the value is `null`/`false`:

| Field | Meaning |
|---|---|
| `description` | What the attribute does. |
| `type` | Allowed type(s) for the **scalar** form (`key: value`). `null` if the attribute *only* ever exists as a dynamic array (see the array rules below). |
| `isArray` | `true` if the attribute supports either array form — `key[]: value` (repeated) or `key: N` followed by `key[0]`..`key[N-1]`. `false` if it's only ever a bare `key: value`. |
| `arrayElementType` | Allowed type(s) for each array element. Required (non-`null`) whenever `isArray` is `true`; must be `null` when `isArray` is `false`. |
| `required` | `true` only if the wiki marks it required — either **bold** text in the attribute table, or a dedicated Required/Optional column (the wiki uses both conventions inconsistently across pages, so check for either). |
| `versionNote` | Same free-text convention as the class-level field, but for this specific attribute. |
| `values` | Only for `token`-typed attributes where the wiki enumerates the valid literals (e.g. `["factory", "aftermarket", "licensed", "unknown"]`). `null` for any other type, or when the wiki doesn't list them. |
| `pointsTo` | Only for `owner_ptr`/`link_ptr` attributes where the wiki names which `class_name`(s) the reference is expected to point to. Can be more than one. `null` when the type doesn't apply, or the wiki doesn't name a target class. |
| `expectedExtensions` | For **any** attribute whose value is a file path (most such attributes are actually typed `string`, not `resource_tie` — see below), the extension(s) expected, without the leading dot (e.g. `["pmd"]`). `null` when not a file path, not documented, or the format doesn't cleanly reduce to one extension (e.g. an attribute that can be either a file path *or* a different string format). |
| `supportsLocalization` | `true` **only** if the attribute's own description explicitly mentions the `@@localization@@` template syntax. This is not a table column — it only ever shows up as a note inside the description text of specific string attributes. |
| `internalOnly` | `true` only if the wiki says this attribute is engine/save-game managed and should not be set manually in a definition. Default assumption is `false` — most attributes exist precisely for you to set. |
| `notes` | Anything else worth keeping that doesn't fit the fields above (default values, caveats, cross-references). Empty string `""` when there's nothing to add. |

**About `resource_tie`:** the wiki's own definition of this type is narrow — *"typically used to bind animations to animated models"*, with its example always being a `.pma` file. Most file-path attributes (model, collision, UI script paths, etc.) are documented as plain `type: ["string"]`, not `resource_tie` — keep them that way rather than "upgrading" them, since `resource_tie` is a real type the engine treats differently internally, not just a synonym for "this is a file path." Use `expectedExtensions` to mark "this is a file path" regardless of which of the two types it actually is.

### `dynamicAttributeGroups`

For the rare case where the wiki describes a whole *family* of attributes collectively instead of naming each one (e.g. `accessory_interior_data`'s "nearly 70 interior animation attributes, plus `_min`/`_max` variants"). Each entry:

```json
{
  "pattern": "interior animation attributes",
  "description": "Nearly 70 interior animation attributes, plus _min/_max variants.",
  "type": ["string", "float"],
  "notes": "Not individually enumerated yet — see Truck_Interior_Animations_and_IDs."
}
```

Leave this `[]` for the overwhelming majority of classes, which name every attribute individually.

## How to decide what to fill in

The rule that resolves basically every "what do I put here?" question: **only document what the wiki page for that exact class explicitly says.** Not what a similar class says, not what seems reasonable, not general modding knowledge — the specific page, for the specific attribute.

If the page doesn't mention something, the field stays `null`/`false`. That is **not** a claim that the behavior doesn't exist in the game — the wiki itself is known to be incomplete in places — it just means it isn't confirmed yet by the source we're building from. A future contributor (or you, later) can always tighten a `null` into a real value once it's confirmed; walking back an incorrect value someone already trusted is much worse.

A quick checklist, in order, for any attribute you're unsure about:
1. Is the type `token`? -> only then does `values` potentially apply (and only if the wiki lists the literals).
2. Is the type `owner_ptr`/`link_ptr`? -> only then does `pointsTo` potentially apply (and only if the wiki names the target class).
3. Is the value clearly a file path? -> `expectedExtensions` potentially applies, regardless of whether the type is `string` or `resource_tie`.
4. Does the page say "must not be set manually" / describe it as engine or save-game data? -> only then `internalOnly: true`. When in doubt, it's `false`.
5. Does the description explicitly say `@@localization@@`? -> only then `supportsLocalization: true`.
6. Anything the page simply doesn't mention -> leave it at its default (`null`/`false`). Never infer from a sibling class's page, even one that looks nearly identical.

## Examples

#### Scalar-only attribute
```sii
name: "Dummy Truck"
```
```json
"name": {
  "description": "Full name for UI display.",
  "type": ["string"],
  "isArray": false,
  "arrayElementType": null,
  "required": false,
  "versionNote": null,
  "values": null,
  "pointsTo": null,
  "expectedExtensions": null,
  "supportsLocalization": false,
  "internalOnly": false,
  "notes": ""
}
```

#### Array-only attribute (never appears as a bare scalar)
```sii
suitable_for[]: "cabin.*"
suitable_for[]: "chassis.*"
```
```json
"suitable_for": {
  "description": "Each member specifies a unit name (or wildcard pattern) required on the vehicle for this accessory to be applicable.",
  "type": null,
  "isArray": true,
  "arrayElementType": ["string"],
  "required": false,
  "versionNote": null,
  "values": null,
  "pointsTo": null,
  "expectedExtensions": null,
  "supportsLocalization": false,
  "internalOnly": false,
  "notes": ""
}
```

#### Counted array (both a scalar count form and an indexed array form)
```sii
dynamic_lod_desc: 2
dynamic_lod_desc[0]: "/path/to/file.pmd"
dynamic_lod_desc[1]: "/path/to/file.pmd"
```
```json
"dynamic_lod_desc": {
  "description": "Number of LOD model descriptors, followed by their paths (.pmd).",
  "type": ["fixed"],
  "isArray": true,
  "arrayElementType": ["string"],
  "required": false,
  "versionNote": null,
  "values": null,
  "pointsTo": null,
  "expectedExtensions": ["pmd"],
  "supportsLocalization": false,
  "internalOnly": false,
  "notes": ""
}
```

#### Attribute the wiki documents with more than one valid type
```sii
width: 1
# or
width: 1.0
```
```json
"width": {
  "description": "",
  "type": ["fixed", "float"],
  "isArray": false,
  "arrayElementType": null,
  "required": false,
  "versionNote": null,
  "values": null,
  "pointsTo": null,
  "expectedExtensions": null,
  "supportsLocalization": false,
  "internalOnly": false,
  "notes": ""
}
```

## Validation

Before opening a PR:
```bash
pnpm validate
```
This checks your file's shape against `.vscode/db.schema.json`, and also cross-file rules a single file can't self-check: that `scope` matches the filename, that `superclass` actually refers to a class that exists (no typos), that there's no inheritance cycle, and that no two files claim the same `scope`.

> Automated checks also run on every PR:
> - JSON field order is normalized automatically.
> - The same validation above runs and comments on the PR if anything fails.

## PR workflow
1. **Fork the repository**
    - Click **Fork** in the top-right corner of GitHub to create a copy under your account.
2. **Clone your fork locally**
```bash
git clone https://github.com/<your-username>/<fork-name>.git
cd <fork-name>
```
3. Configure upstream (to keep your fork in sync with the original repository)
```bash
git remote add upstream https://github.com/duhnunes/scs-schema.git
git fetch upstream
git checkout master
git merge upstream/master
```
4. Create a descriptive branch
```bash
git checkout -b feat/add-<class_name>
```
5. Stage and commit your changes
```bash
git add .
git commit -m "feat(schemas): add <class_name>"
```
> Use conventional commit style: `feat(schemas): add <class_name>` or `fix(schemas): fix <class_name>`
6. Push to your fork
```bash
git push origin feat/add-<class_name>
```
7. Open a Pull Request
- Go to your fork on GitHub and click **Compare & pull request**
- Or use the [GH CLI](https://cli.github.com/)
```bash
gh pr create --repo duhnunes/scs-schema \
  --head <your-username>:feat/add-<class_name> \
  --base master \
  --title "feat(schemas): add <class_name>" \
  --body "Clear description of the change"
```

> [!IMPORTANT]
> Always sync your fork with `upstream/master` before opening a PR.
> The repository automatically updates `manifest.json` and bumps schema versions after PRs are merged.
> Keeping your fork up to date avoids conflicts.

## Checklist before PR
- [x] Filename equals the `class_name`.
- [x] `meta.version` set (start with `"0.1.0"`), `meta.documentationStatus` set.
- [x] `scope` equals `class_name` and the filename.
- [x] `superclass` set (a real class name, or `"unit"` if there's no documented parent).
- [x] `key` contains only this class's **own** attributes — nothing inherited copied in.
- [x] Every attribute has all 12 fields present, with anything unconfirmed by the wiki left as `null`/`false` rather than guessed.
- [x] `pnpm validate` passes locally.

## Automated PR workflow

Once you open a Pull Request, the repository's automation takes care of the full pipeline:

1. **Proxying**
    - External (forked) PRs are mirrored into a local branch inside the main repository, preserving your original commit authorship.
    - This is what lets the rest of the pipeline run with full permissions against your changes.
    - From your perspective, you just open a PR normally — this happens automatically.

2. **Validation**
    - JSON schemas are automatically reformatted (field order, array normalization).
    - The same rules `pnpm validate` runs locally are checked again here.
      - If everything is correct, the PR is labeled `validated`.
      - If validation fails, the PR is labeled `invalid-schema` and commented with the specific errors — fix and push again to re-trigger the check.

3. **Building**
    - Runs daily at 00:00 UTC (or can be triggered manually).
    - Bumps `meta.version` on any changed files, resolves inheritance, regenerates `data/dist/` (the flattened files the extension actually fetches), and updates `manifest.json` with fresh CDN URLs.
    - If successful, the PR is labeled `ready`. If your branch has a merge conflict with `master`, it's labeled `conflict` instead and paused until you resolve it.

4. **Merging**
    - Every `ready` PR is automatically squash-merged into `master`, crediting every real commit author as a co-author on the merge commit.

**In short**: Just focus on writing correct schemas under `data/schemas/`, following the field-by-field rules above. The automation takes care of everything else — formatting, validation, inheritance resolution, versioning, CDN generation, and merging.
