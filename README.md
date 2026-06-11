# scs-schema

Static schema data and manifest generator for <a href="https://github.com/duhnunes/scs-intellisense">SCS-Intellisense</a> Systems.
This repository stores JSON schema files under `data/schemas`, validates them, and produces a `data/manifest.json` that references each schema by a **publich CDN URL** (jsDelivr) using a **commit SHA**.
