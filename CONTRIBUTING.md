# Contributing to SCS Schemas Database

Thanks for helping improve the schema database used by the <a href="https://github.com/duhnunes/scs-intellisense">SCS IntelliSense</a> VSCode extension. This guide is only for contributions that edit `.json` files inside `data/schemas/`.

> [!NOTE]
> This guide describes **format v3**. If you consume the generated data (`data/dist/`, the manifest), see [docs/migrating-to-v3.md](./docs/migrating-to-v3.md).

---

## Table of Contents
- [Quick rules (must follow)](#quick-rules-must-follow)
- [What you can edit](#what-you-can-edit)
- [File location](#file-location)
- [File format and field rules](#file-format-and-field-rules)
  - [Class-level fields](#class-level-fields)
  - [Attribute fields (inside `key`)](#attribute-fields-inside-key)
  - [Types](#types)
- [Where information comes from](#where-information-comes-from)
- [Example](#example)
- [Validation](#validation)
- [PR workflow](#pr-workflow)
- [Checklist before PR](#checklist-before-pr)
- [Automated PR workflow](#automated-pr-workflow)

## Quick rules (must follow)
- **Every class already has a file.** All unit classes of the game are in `data/schemas/`, most of them with names and types only (`documentationStatus: "undocumented"`). Contributions are mostly about **describing** them.
- **Don't edit the generated fields** (`type`, `isArray`, enum `values`, `pointsTo`, `status`, `superclass`, and adding or removing attributes): they're generated from the game and refreshed on every game update, so a manual change would be overwritten. If one looks wrong, open an issue.
- **Only write what a source confirms** (see [Where information comes from](#where-information-comes-from)). If you're not sure, leave the field empty (`""` / `null` / `false`).
- **Never copy in inherited attributes.** `key` only lists the attributes this class adds itself; `scripts/build.mjs` merges in the inherited ones.
- **Don't touch `meta.version`**: the automation bumps it.

## What you can edit
| Field | Level |
|---|---|
| `description` | class and attribute |
| `versionNote` | class and attribute |
| `allowsSiiNunitRoot` | class |
| `meta.documentationStatus` | class |
| `default`, `expectedExtensions`, `required`, `supportsLocalization`, `internalOnly`, `notes` | attribute |
| `values` | attribute, **only for `token`** attributes (enum values are generated) |

## File location

**Files are flat.** Every schema lives directly under `data/schemas/`, named after its `class_name`. Namespaced classes write `::` as `.`, because `:` isn't allowed in Windows file names:

```
data/schemas/
  accessory_data.json        <- accessory_data
  ui.text_common.json        <- ui::text_common
  ...
```

The game's own folders don't matter here: the extension finds a class through the manifest, never through a path.

## File format and field rules

### Class-level fields

| Field | Notes |
|---|---|
| `meta.version` | Semver of the file. `"0.1.0"` on a new file, then bumped automatically. Don't edit. |
| `meta.documentationStatus` | `"complete"`: the class and all its active attributes are described. `"wip"`: partly described, or the wiki page shows the *"yet to be reviewed by SCS staff"* notice. `"undocumented"`: names and types only. |
| `scope` | The `class_name`. Must match the file name (`::` written as `.`). |
| `description` | A sentence or two about the class. `""` when not documented yet. |
| `superclass` | Generated. The **direct** parent class; `"unit"` means no real parent. |
| `versionNote` | Free text, as the wiki phrases it (e.g. `"Added in 1.38."`). `null` when there's nothing to say. Display-only: the extension never knows the user's game version. |
| `allowsSiiNunitRoot` | `false` **only** if the documentation says the class must not be used as a file's `SiiNunit` root (it's only `@include`d). `true` otherwise. |
| `key` | This class's **own** attributes. Generated list; edit the documentation fields only. |

### Attribute fields (inside `key`)

Every attribute has **all** of these fields, even when the value is empty:

| Field | Generated | Meaning |
|---|---|---|
| `description` | | What the attribute does. `""` when not documented yet. |
| `type` | ✔ | The type of the value (of each element, for arrays). See [Types](#types). |
| `isArray` | ✔ | `true` for arrays. Arrays can be written as repeated `key[]: value` lines, or as `key: N` followed by `key[0]`..`key[N-1]`. |
| `values` | ✔ for `enum` | `enum`: the valid names (generated; `null` when unknown). `token`: the valid literals, **only** if a source lists them. `null` for anything else. |
| `pointsTo` | ✔ | For `owner_ptr` / `link_ptr` / `volatile_link_ptr`: the class the target unit is expected to be (its subclasses too). |
| `status` | ✔ | `"active"`, or `"legacy"`: still accepted by the game but its value isn't used (usually replaced by another attribute). Legacy attributes aren't suggested in completion and aren't reported as errors. |
| `default` | | Default value, written as in a `.sii` file (`"0"`, `"default"`, `"true"`). `null` when not documented. |
| `expectedExtensions` | | For file-path values: the extension(s) without the dot, e.g. `["pmd"]`. `null` when not a file path, or when the value isn't a single kind of file (e.g. a `.soundref` file **or** a `bank#event` string). |
| `required` | | `true` only if the documentation marks it required. |
| `versionNote` | | Same as the class-level field. |
| `supportsLocalization` | | `true` only if the value supports the `@@localization@@` syntax. |
| `internalOnly` | | `true` for attributes not meant for mods: engine/save-game managed, or used only by SCS (e.g. `steam_inventory_id`). Hidden from completion. |
| `notes` | | Anything else worth keeping. `""` when there's nothing to add. |

### Types

`type` is always **one** of the game's own type names: `string`, `token`, `float`, `float2`–`float4`, `fixed`, `fixed2`–`fixed4`, `float4x4`, `quat`, `placement`, `placement_scale`, `placement_nonuniform`, `plane`, `sphere`, `aabox`, `int`, `uint`, `s16`, `u16`, `s32`, `u32`, `s64`, `u64`, `int2`, `uint2`, `bool`, `enum`, `owner_ptr`, `link_ptr`, `volatile_link_ptr`, `resource_tie`. Each one is described (with its syntax, when documented) in `.vscode/db.schema.json`, which also gives you IntelliSense while editing.

A value can look different in SCS files and still have one type: a `float` can be written `1`, `1.0` or `&3f800000`, and a `token` is sometimes quoted (`"default"`). That's the text form, not a different type.

## Where information comes from

Two sources count, and silence in both stays silence in the JSON:
1. **The SCS modding wiki** — the page for **that exact class** (not a sibling class, even one that looks identical).
2. **SCS's own game files** (`.sii`/`.sui` inside the game's `.scs` archives) — for how an attribute is actually used: e.g. the extension real files use for a path, or the values a `token` takes.

When they disagree, write what the game files do and record the wiki's version in `notes` (e.g. *"The wiki documents the extension as .pmg; SCS files use .pmd."*).

"Not documented" is not "doesn't exist": leave unknown fields empty. Tightening a `null` later is easy; walking back a wrong value someone already trusted is not.

## Example

```sii
accessory_cabin_data : day.kenworth.w900.cabin
{
	wiper_anim: "/vehicle/truck/kenworth_w900/cabin/wipers_anim.pma"
	sounds: 2
	sounds[]: "horn|/sound/truck/horn/horn_02.soundref"
	sounds[]: "aero_noise|/sound/truck/default/noise_aero.soundref"
}
```
```json
"wiper_anim": {
  "description": "Path to the wiper animation (.pma).",
  "type": "string",
  "isArray": false,
  "values": null,
  "pointsTo": null,
  "status": "active",
  "default": null,
  "expectedExtensions": ["pma"],
  "required": false,
  "versionNote": null,
  "supportsLocalization": false,
  "internalOnly": false,
  "notes": ""
},
"sounds": {
  "description": "Each item assigns a sound event to a function, using the \"sound_name|sound_path\" format.",
  "type": "string",
  "isArray": true,
  "values": null,
  "pointsTo": null,
  "status": "active",
  "default": null,
  "expectedExtensions": null,
  "required": false,
  "versionNote": "Added in 1.39.",
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

> The same validation runs automatically on every PR and comments on it if anything fails.
> JSON field order is normalized automatically after the merge, so you don't need to worry about it.

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
git checkout -b feat/describe-<class_name>
```
5. Stage and commit your changes
```bash
git add .
git commit -m "feat(schemas): describe <class_name>"
```
> Use conventional commit style: `feat(schemas): describe <class_name>` or `fix(schemas): fix <class_name>`.
> The **PR title** matters most: PRs are squash-merged, so the title becomes the commit message that decides the version bump.
6. Push to your fork
```bash
git push origin feat/describe-<class_name>
```
7. Open a Pull Request
- Go to your fork on GitHub and click **Compare & pull request**
- Or use the [GH CLI](https://cli.github.com/)
```bash
gh pr create --repo duhnunes/scs-schema \
  --head <your-username>:feat/describe-<class_name> \
  --base master \
  --title "feat(schemas): describe <class_name>" \
  --body "Clear description of the change"
```

> [!IMPORTANT]
> Always sync your fork with `upstream/master` before opening a PR.
> The repository automatically bumps schema versions and updates `data/dist/` and the manifest after PRs are merged. Never edit those files in a PR: it will be rejected.
> Keeping your fork up to date avoids conflicts.

## Checklist before PR
- [x] Only documentation fields changed (no generated field, no attribute added or removed).
- [x] Everything written is confirmed by the wiki page for that class or by SCS's game files; nothing guessed.
- [x] `meta.documentationStatus` updated if the class is now more (or fully) described.
- [x] `pnpm validate` passes locally.

## Automated PR workflow

Once you open a Pull Request, the repository's automation takes care of the full pipeline. Your PR stays your PR: it is checked and merged as it is, nothing is pushed to your branch.

1. **Checking** (every time you push to the PR; draft PRs are skipped until marked ready for review)
    - The same rules `pnpm validate` runs locally are checked against the current `master`.
    - PRs that edit `data/dist/`, `data/manifest.json` or `data/manifest.v3.json` are rejected: those files are generated.
    - Results:
      - Everything is correct and the PR only touches `data/schemas/`: labeled `validated`.
      - Your **first contribution**, or a PR that deletes a schema: also labeled `awaiting-approval`. It is merged only after the owner reviews and approves it, which can take a few days. Pushing new commits after the approval requires a new one. Once you've had a PR merged, your next ones no longer need approval (except deletions).
      - The check fails: labeled `invalid-schema` and commented with the specific errors — fix and push again to re-trigger the check.
      - The PR also touches other files: labeled `documentation` or `system`, and it waits for the owner's review instead of being merged automatically.

2. **Merging and building**
    - Runs daily at 00:00 UTC (or can be triggered manually).
    - Every `validated` PR (once approved, if it was `awaiting-approval`) is checked once more against the latest `master` and squash-merged, crediting every commit author as a co-author. If it conflicts with `master`, it's labeled `conflict` instead — update your branch and push again.
    - Then, on `master`: bumps `meta.version` on changed files, normalizes the JSON (field order, array normalization), resolves inheritance, regenerates `data/dist/v3/` (the flattened files the extension actually fetches), and updates `data/manifest.v3.json` with fresh CDN URLs.

**In short**: Just focus on writing correct schemas under `data/schemas/`, following the field-by-field rules above. The automation takes care of everything else — validation, merging, formatting, inheritance resolution, versioning and CDN generation.
