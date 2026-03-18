import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS_DIR = path.join(ROOT_DIR, 'Schemas');
const RUNTIME_DIR = path.join(ROOT_DIR, 'public', 'runtime');
const SEF_DIR = path.join(
  ROOT_DIR,
  'node_modules',
  'node-xsl-schematron',
  'src',
  'stylesheets',
  'sef',
);

const TITLE_REGEX = /<title>(.*?)<\/title>/s;
const UBL_NAMESPACE_REGEX = /<ns\s+uri="([^"]+)"\s+prefix="ubl"\s*\/>/s;
const PROFILE_TOKENIZE_REGEX = /tokenize\('([^']*urn:fdc:peppol\.eu:poacc:bis:[^']*)', '\\s'\)/g;
const PROFILE_EXACT_REGEX =
  /normalize-space\(text\(\)\)\s*=\s*'(urn:fdc:peppol\.eu:poacc:bis:[^']+)'/g;
const CUSTOMIZATION_EXACT_REGEX =
  /normalize-space\(text\(\)\)\s*=\s*'(urn:fdc:peppol\.eu:poacc:trns:[^']+)'/g;
const CUSTOMIZATION_PREFIX_REGEX =
  /starts-with\(normalize-space\(\.\),\s*'(urn:fdc:peppol\.eu:poacc:trns:[^']+)'\)/g;

await fs.mkdir(RUNTIME_DIR, { recursive: true });
await Promise.all([
  copyRuntimeAsset('pipeline-for-svrl.sef.json'),
  copyRuntimeAsset('runner.sef.json'),
  writeSchemaRegistry(),
]);

async function copyRuntimeAsset(fileName) {
  await fs.copyFile(path.join(SEF_DIR, fileName), path.join(RUNTIME_DIR, fileName));
}

async function writeSchemaRegistry() {
  const files = (await fs.readdir(SCHEMAS_DIR)).filter((file) => file.endsWith('.sch')).sort();
  const schemas = [];

  for (const fileName of files) {
    const schematron = await fs.readFile(path.join(SCHEMAS_DIR, fileName), 'utf8');
    const title = schematron.match(TITLE_REGEX)?.[1]?.trim();
    const namespaceUri = schematron.match(UBL_NAMESPACE_REGEX)?.[1]?.trim();

    if (!title || !namespaceUri) {
      throw new Error(`Failed to parse schema metadata from ${fileName}`);
    }

    schemas.push({
      transactionCode: fileName.match(/T\d+/)?.[0] ?? fileName,
      fileName,
      title,
      documentType: namespaceToDocumentType(namespaceUri),
      namespaceUri,
      profileIds: unique([
        ...collectTokenizedMatches(PROFILE_TOKENIZE_REGEX, schematron),
        ...collectMatches(PROFILE_EXACT_REGEX, schematron),
      ]),
      customizationIds: unique(collectMatches(CUSTOMIZATION_EXACT_REGEX, schematron)),
      customizationPrefixes: unique(collectMatches(CUSTOMIZATION_PREFIX_REGEX, schematron)),
      schematron,
    });
  }

  await fs.writeFile(path.join(RUNTIME_DIR, 'schema-registry.json'), JSON.stringify(schemas));
}

function namespaceToDocumentType(namespaceUri) {
  return namespaceUri.match(/:([^:]+)-\d+$/)?.[1] ?? namespaceUri;
}

function collectMatches(regex, value) {
  return Array.from(value.matchAll(regex), (match) => match[1].trim());
}

function collectTokenizedMatches(regex, value) {
  return Array.from(value.matchAll(regex), (match) => match[1].split(/\s+/).filter(Boolean)).flat();
}

function unique(values) {
  return [...new Set(values)];
}
