# scs-schema

Static schema data and manifest generator for <a href="https://github.com/duhnunes/scs-intellisense">SCS-Intellisense</a> extension.
This repository stores JSON schema files under `data/schemas/` and produces a `data/manifest.json` that references each schema by a **publich CDN URL** (jsDelivr) using a **commit SHA**.


## Repository purpose

This repo is a curted database of schema files that describe `class_name` blocks found in SCS `.sii` files (American Truck SImulator and related games). The manifest generator collects every schema file, computes integrity metadata (SHA256 and size) and writes `data/manifest.json` with URLs that point to the exact file version on jsDelivr using a commit hash.


## Layout
- **`data/schemas/`** - JSON schema files. Files must mirror the gme folder structure (for example `/def/world/prefab_model.sii` -> `data/schemas/def/world/prefab_model.json`)
- **`data/manifest.json`** - generated manifest with metadata for each schema.
- **`scripts/build.mjs`** - manifest generator script used by maintainers/CI to update `data/manifest.json`
- **`CONTRIBUTING.md`** - contribution guide for adding or editign schema files.



## How the manifest URLs work

- Each schema entry in the manifest includes a `url` that points to jsDelivr in the form: `https://cdn.jsdelivr.net/gh/<REPO_USER>/<REPO_NAME>@<COMMIT_SHA>/data/schemas/<path.json>`
- The manifest also stores `hash` (prefixed with `sha256:`) and `size` so consumers can verify integrity.



## Quick usage for maintainer

Generate or update the manifest locally (no commit required):
```bash
node ./scripts/build.mjs --no-commit
```
This will scan `data/schemas/**.json`, compute hashes and sizes, and write `data/manifest.json`. When ready, commit and push the updates manifest.



## Contributing
If you want to help populate the database with schema files, please read <a href="./CONTRIBUTING.md">CONTRIBUTING.md</a> first.
It contains the exact rules for file naming, folder lyout, and the JSON structure we expect for each schema file.

## Notes for integrtors
- The manifest is intended to be consumed by the SCS IntelliSense extension and other tooling that need stable, CDN-hosted schema files.
- URLs use a commit SHA to guarntee immutability: the same URL always points to the same file contents.



## License
- Licensed under the <a href="./LICENSE.md">MIT</a>
