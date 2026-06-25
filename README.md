# scs-schema

Static schema data and manifest generator for <a href="https://github.com/duhnunes/scs-intellisense">SCS-Intellisense</a> extension.
This repository stores JSON schema files under `data/schemas/` and produces a `data/manifest.json` that references each schema by a **publish CDN URL** (jsDelivr) using a **commit SHA**.


## Repository Purpose

This repo is a curated database of schema files that describe `class_name` blocks found in SCS files (American Truck Simulator and related games). The manifest generator collects every schema file, computes integrity metadata (SHA256 and size) and writes `data/manifest.json` with URLs that point to the exact file version on jsDelivr using a commit hash.


## Layout
- **`data/schemas/`**: JSON schema files. Files mirror the game folder structure:
  - `/def/world/prefab_model.sii` -> `data/schemas/def/world/prefab_model.json`
  - `c:/$user_name/documents/multimon_config.sii` -> `data/schemas/documents/multimon_config.json`
- **`data/manifest.json`**: Generated manifest with metadata for each schema.
- **`scripts/build.mjs`**: Updates schema URLs in `data/manifest.json` using the current commit SHA and changed files.
- **`scripts/update.mjs`**: Scans schema files, calculates hash/size, bumps version (`major`, `minor`, `patch`) based on commit messages, and updates `data/manifest.json`.
- **`scripts/validate.mjs`**: Validates all schema files against `.vscode/schema.json` using Ajv.
- **`scripts/formatter.mjs`**: Normalizes field order (`meta`, `scope`, `key`), sorts types and arrays, and ensures consistent formatting across schema files.

## Automation
This repository includes automated workflows to keep the schema database consistent:
- Every pull request runs validation checks (`scripts/validate.mjs`) to ensure schema files follow the expected structure.
- JSON files are automatically normalized (`scripts/formatter.mjs`) to enforce consistent formatting and field ordering.
- Schema versions are bumped (`scripts/update.mjs`) and the manifest (`data/manifest.json`) is rebuilt with updated URLs (`scripts/build.mjs`) as part of the CI pipeline, before merges are completed.

These automations reduce manual work and guarantee that the database stays reliable for consumers.

## How the manifest URLs work

- Each schema entry in the manifest includes a `url` pointing to jsDelivr in the form:  
  `https://cdn.jsdelivr.net/gh/<REPO_USER>/<REPO_NAME>@<COMMIT_SHA>/data/schemas/<path/to/file.json>`  
  This guarantees immutability: the same URL always points to the same file contents.
- The manifest also stores `hash` (prefixed with `sha256:`) and `size` so consumers can verify file integrity.
- These fields are automatically maintained by the CI pipeline: `scripts/update.mjs` computes hash and size, while `scripts/build.mjs` updates URLs.

## Scripts

> [!INFO]
> These scripts are part of the repository's automation pipeline.
> They were not designed to be run manually - CI workflows handle them automatically.

- `./scripts/build.mjs` - Updates schema URLs in `manifest.json` using the current commit SHA and changed files.
- `./scripts/update.mjs` - Walks through schema files, calacultes hash/size, bumps versions (`patch`, `minor`, `major`) based on commit messages, and updates `manifest.json`.
- `./scripts/validate.mjs` - Validates all schema files against `.vscode/schema.json` using Ajv.
- `./scripts/formatter.mjs` - Normalizes field order (`meta`, `scope`, `key`), sorts types and arrays, and ensures consistent formatting across schema files.

## Contributing

Contributions are welcome!
To add or edit schema files, please read <a href="./CONTRIBUTING.md">CONTRIBUTING</a> first.
It contains the exact rules for file naming, folder layout, and the JSON structure required for each schema file, as well as guidelines to ensure consistency across the repository.

## Notes for integrators

- The manifest is designed to be consumed by the SCS IntelliSense extension and also by any external tooling that requires stable, CDN-hosted schema files.
- Each entry in the manifest includes a `url`, `hash`, and `size`, allowing consumers to verify both immutability and file integrity.
- Because URLs are tied to a commit SHA, they are immutable: the same URL will always resolve to the exact same file contents.


## License
- Licensed under the <a href="./LICENSE.md">MIT</a>
