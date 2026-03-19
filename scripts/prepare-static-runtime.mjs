import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS_DIR = path.join(ROOT_DIR, 'Schemas');
const RUNTIME_DIR = path.join(ROOT_DIR, 'public', 'runtime');
const SAXON_JS_RUNTIME = path.join(RUNTIME_DIR, 'SaxonJS2.rt.js');
const NODE_XSL_SCHEMATRON_DIR = path.join(ROOT_DIR, 'node_modules', 'node-xsl-schematron');
const XSLT3_BIN = path.join(ROOT_DIR, 'node_modules', 'xslt3', 'xslt3.js');

const RUNTIME_STYLESHEETS = [
  {
    outputFileName: 'pipeline-for-svrl.sef.json',
    stylesheetPath: path.join(
      NODE_XSL_SCHEMATRON_DIR,
      'lib',
      'schxslt-1.9.5',
      '2.0',
      'pipeline-for-svrl.xsl',
    ),
  },
  {
    outputFileName: 'runner.sef.json',
    stylesheetPath: path.join(NODE_XSL_SCHEMATRON_DIR, 'lib', 'runner.xsl'),
  },
];

const TITLE_REGEX = /<title>(.*?)<\/title>/s;
const UBL_NAMESPACE_REGEX = /<ns\s+uri="([^"]+)"\s+prefix="ubl"\s*\/>/s;
const PROFILE_TOKENIZE_REGEX = /tokenize\('([^']*urn:fdc:peppol\.eu:poacc:bis:[^']*)', '\\s'\)/g;
const PROFILE_EXACT_REGEX =
  /normalize-space\(text\(\)\)\s*=\s*'(urn:fdc:peppol\.eu:poacc:bis:[^']+)'/g;
const CUSTOMIZATION_EXACT_REGEX =
  /normalize-space\(text\(\)\)\s*=\s*'(urn:fdc:peppol\.eu:poacc:trns:[^']+)'/g;
const CUSTOMIZATION_PREFIX_REGEX =
  /starts-with\(normalize-space\(\.\),\s*'(urn:fdc:peppol\.eu:poacc:trns:[^']+)'\)/g;

await assertPathExists(SCHEMAS_DIR, 'Schemas directory');
await assertPathExists(XSLT3_BIN, 'xslt3 CLI');
await Promise.all(
  RUNTIME_STYLESHEETS.map(({ stylesheetPath, outputFileName }) =>
    assertPathExists(stylesheetPath, `${outputFileName} source stylesheet`),
  ),
);

await fs.mkdir(RUNTIME_DIR, { recursive: true });
await assertPathExists(SAXON_JS_RUNTIME, 'Vendored SaxonJS browser runtime');
await Promise.all([
  ...RUNTIME_STYLESHEETS.map(({ outputFileName, stylesheetPath }) =>
    compileRuntimeAsset(outputFileName, stylesheetPath),
  ),
  writeSchemaRegistry(),
]);

async function assertPathExists(filePath, label) {
  try {
    await fs.access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${label} was not found at ${filePath}. Run \"npm install\" before building.`);
  }
}

async function compileRuntimeAsset(outputFileName, stylesheetPath) {
  const outputPath = path.join(RUNTIME_DIR, outputFileName);

  try {
    await execFileAsync(process.execPath, [
      XSLT3_BIN,
      `-xsl:${stylesheetPath}`,
      `-export:${outputPath}`,
      '-nogo',
    ]);
  } catch (error) {
    const details = [error.stdout, error.stderr].filter(Boolean).join('\n').trim();
    throw new Error(
      details
        ? `Failed generating ${outputFileName}.\n${details}`
        : `Failed generating ${outputFileName}.`,
    );
  }
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
