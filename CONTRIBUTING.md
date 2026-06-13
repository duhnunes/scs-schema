# Contributing to SCS Schema Database

Thanks for helping improve the schema database used by the <a href="https://github.com/duhnunes/scs-intellisense">SCS IntelliSense</a> VSCode extension. This document explains how to add or edit JSON schema files under `data/schemas/`. This guide is only for contributions that add or edit `.json` files inside `data/schemas/`.

---

## Quick rules (must follow)
- **Filename**: must be `class_name.json`, where `class_name` exactly matches the `class_name` used in the game `.sii` files.
- **Scope**: the file must contains a `scope` field equal to the `class_name` (same as the filename)
- **Required top-level fields**: `meta`, `scope`, `key`
- **Versioning**: start with `meta.version: 0.1.0`

## File location and path structure
**Files must mirror the game's folder structure.**  
Place each `class_name.json` under `data/schemas/` using the same relative path used by the game `.sii` files.

- Example: the game file `/def/world/prefab_model.sii` -> schema file `data/schemas/def/world/prefab_model.json`.
- Example: `/def/world/curve_model.sii` -> `data/schemas/def/world/curve_model.json`

This rule helps the extension map schemas to `.sii` files and keeps the DB organized.

## File format and field rules
- **meta**
  - **`version`**: semantic version string (start `0.1.0`)
  - **`description`**: short summary of the class.
- **scope**
  - Must equal the `class_name` in the game `.sii` files.
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

## Validation (what expect from contributors)
This project only requires that contributed files are valid JSON and follow the structure described above. Before opening a PR:
- Make sure the file pth mirrors the gme path (see File loction nd path structure)
- Ensure scope mtches the filename (bsename whtout .json)
- No additional tooling or build steps are required for content-only contributions.

## PR workflow
1. **Fork** (if needed) and create a descriptive branch: `feat/add-<class_name>`
2. **Sync your branch**: run `git pull` to update before staging changes.
3. **Stage and commit**;
    - `git checkout -b feat/add-<class_name>`
    - `git add .`
    - `git commit -m "feat(schemas): add <class_name>.json"`
      - Use conventional style, e.g. `feat(schema): add <class_name>` or `fix(schema): fix <class_name>`
4. **Open PR**: include a short summary (with [GH CLI](https://cli.github.com/))
    - `gh pr create` - and follow the terminal prompts

> [!IMPORTANT]  
> Always run `git pull` before staging changes (`git add .`).
> The repository automatically updates `manifest.json` and bumps schema versions after PRs are merged.
> Runing `git pull` ensures your local branch is up to date and avoids conflicts.

## Checklist before PR
- [x] Filename matches `class_name` (e.g., `prefab_model.json)
- [x] Schema file placed in the same relative path as the game `.sii` (e.g. `data/schemas/def/world/prefab_model.json` for `/def/world/prefab_model.sii`)
- [x] `meta.version` set (stat with `"0.1.0"`)
- [x] `scope` equals `class_name`
- [x] Every `key` has `description`, `type`, `isArray`, `arrayElementType`
