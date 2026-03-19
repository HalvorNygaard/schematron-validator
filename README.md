# Schematron Validator

Client-side Angular app for validating Peppol XML documents against the Schematron files in `Schemas/`.

## Development

```bash
npm install
npm start
```

`npm start` prepares the generated runtime assets, downloads the official SaxonJS browser runtime if needed, precompiles browser-safe validator bundles for each Schematron file, and serves the app as a standard Angular SPA.

## Production build

```bash
npm run build
```

## GitHub Pages build

```bash
npm run build:pages
```

GitHub Actions publishes `dist/schematron-validator/browser` to Pages and injects the correct repository base path at build time.
