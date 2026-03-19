# Schematron Validator

Client-side Angular app for validating Peppol and EHF XML documents against the Schematron files in `Schemas/`.

`Schemas/` is the source of truth. `Schemas/registry.json` explicitly defines which source package, document type, identifiers, and `.sch` stack apply to each profile.

## Development

```bash
npm install
npm run prepare:runtime
npm start
```

Run `npm run prepare:runtime` whenever you change files in `Schemas/` or `Schemas/registry.json`.

`npm start` now just serves the Angular app and uses the committed runtime assets already in `public/runtime/`.

## Schema sources

- `Schemas/*.sch` contains the standalone Peppol source files
- `Schemas/ehf-postaward-g3/` contains the imported EHF package files
- `Schemas/registry.json` decides which package and which single-file or multi-file Schematron stack is used for a given document profile

The app does not guess validation stacks from filenames anymore. If a profile needs multiple Schematron layers, list them in order in `Schemas/registry.json`.

## Runtime assets

- `public/runtime/schema-registry.json` is generated from `Schemas/registry.json`
- `public/runtime/results.sef.json` is the compiled result transformer
- `public/runtime/validators/` contains the compiled validator bundles used by the browser

These generated runtime files are committed to git. The project does not recompile them automatically during `npm start`, `npm run build`, or GitHub Actions builds.

## Production build

```bash
npm run build
```

`npm run build` assumes those runtime assets are already up to date.

## Matching rules

- The runtime first matches on the XML root local name and namespace.
- It then narrows candidates deterministically using explicit `CustomizationID` and `ProfileID` values from `Schemas/registry.json`.
- Exact `CustomizationID` wins over prefix matches, and both win over unconstrained entries.
- Exact `ProfileID` then narrows the remaining candidates.
- If multiple candidates still remain, validation stops with an ambiguity error instead of guessing.
- For profiles that require layered validation, the `schematrons` array is executed in order and all findings are merged.

## GitHub Pages build

```bash
npm run build:pages
```

GitHub Actions publishes `dist/schematron-validator/browser` to Pages and injects the correct repository base path at build time.
