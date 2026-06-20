# Contributing to SCS Schema Database

Thanks for helping improve the schema database used by the <a href="https://github.com/duhnunes/scs-intellisense">SCS IntelliSense</a> VSCode extension. This document explains how to add or edit JSON schema files under `data/schemas/`. This guide is only for contributions that add or edit `.json` files inside `data/schemas/`.

---

## Quick rules (must follow)
- **Filename**: must equal the `class_name`
    - This avoids duplication when multiple game files share the same class but have different filenames.
    - Examples: all `gate_model.*.sii` variations -> schema file `gate_model.json`.
- **Scope**: the file must contains a `scope` field equal to the `class_name`.
- **Required top-level fields**: `meta`, `scope`, `key`
- **Versioning**: start with `meta.version: 0.1.0`

## File location and path structure
**Files must mirror the game's folder structure.**  
Place each schema under `data/schemas/` using the same relative path used by the game files.

- Example: `/def/world/prefab_model.sii` -> `data/schemas/def/world/prefab_model.json`.
- Example: `/def/world/curve_model.sii` -> `data/schemas/def/world/curve_model.json`

This rule helps the extension map schemas to game files and keeps the DB organized.

## File format and field rules
- **meta**
  - **`version`**: semantic version string (start `0.1.0`)
  - **`description`**: short summary of the class.
- **scope**
  - Must equal the `class_name` in the game files (e.g. `prefab_model`).
- **key**
  - Each property under `key` represents a possible key in the `class_name` block.
  - For each key include:
    - **`description`**: clear explanation of the key. (If you know)
    - **`type`**: if the key exists without `[]`, set an array of types (e.g., `["token"]`); if it never appers without `[]`, set `null`
    - **`isArray`**: `true` if the key is an array (`key[]`), otherwise `false`
    - **`arrayElementType`**: when `isArray: true`, set the element type array (e.g., `["float2"]`); otherwise `null`

> [!IMPORTANT]  
> **Important**: keep `type` and `arrayElementType` consistent: If a key exists both as scalar and array, reflect both forms (scalar `type` and `isArray: true` with `arrayElementType`).


### Examples
#### With scalar & not array
```sii
SiiNunit {
  model_def : unit.name {
    name: "name"
  }
}
```
```json
"name": {
  "description": "",
  "type": ["string"],
  "isArray": false,
  "arrayElementType": null
}
```
#### With scalar and array key:
```sii
SiiNunit {
  model_def : unit.name {
    dynamic_lod_desc: 2
    dynamic_lod_desc[0]: "/path/to/file.pmd"
    dynamic_lod_desc[1]: "/path/to/file.pmd"
  }
}
```
```json
"dynamic_lod_desc": {
  "description": "",
  "type": ["fixed"],
  "isArray": true,
  "arrayElementType": ["resource_tie"]
}
```
#### With array & not scalar:
```sii
SiiNunit {
  mover_action : unit.name {
    timer_params[]: ""
  }
}
```
```json
"timer_params": {
  "description": "",
  "type": null,
  "isArray": true,
  "arrayElementType": ["string"]
}
```
#### With double type
```sii
SiiNunit {
  road_edge : unit.name {
    width: 1
    # or
    width: 1.0
  }
}
```
```json
"width": {
  "description": "",
  "type": ["fixed", "float"],
  "isArray": false,
  "arrayElementType": null
}
```

## Validation
Before opening a PR:
- Ensure the file path mirrors the game path.
- Run local validation:
```bash
pnpm validate
```
###### This command checks your JSON schemas against the project rules.

> Automated checks will also run on every PR:
> - JSON formatting is normalized automatically.
> - Schema validation runs and comments on the PR if errors are found.

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
git commit -m "feat(schemas): add <file_name>.json"
```
> Use conventional commit style: `feat(schemas): add <file_name>` or `fix(schemas): fix <file_name>`
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
  --title "feat(schemas): add <file_name>.json" \
  --body "Clear description of the change"
```

> [!IMPORTANT]  
> Always sync your fork with `upstream/master` before opening a PR.
> The repository automatically updates `manifest.json` and bumps schema versions after PRs are merged.
> Keeping your fork up to date avoids conflicts.

## Checklist before PR
- [x] Filename equals the class_name.
- [x] Schema file placed in the same relative path as the game file
- [x] `meta.version` set (start with `"0.1.0"`)
- [x] `scope` equals `class_name`
- [x] Every `key` has `description`, `type`, `isArray`, `arrayElementType`
