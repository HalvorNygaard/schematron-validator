import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS_DIR = path.join(ROOT_DIR, 'Schemas');
const RUNTIME_DIR = path.join(ROOT_DIR, 'public', 'runtime');
const VALIDATORS_DIR = path.join(RUNTIME_DIR, 'validators');
const SAXON_JS_RUNTIME = path.join(RUNTIME_DIR, 'SaxonJS2.rt.js');
const SAXON_JS_RUNTIME_URL =
  process.env.SAXON_JS_RUNTIME_URL ??
  'https://www.saxonica.com/saxon-js/documentation/SaxonJS/SaxonJS2.rt.js';
const NODE_XSL_SCHEMATRON_DIR = path.join(ROOT_DIR, 'node_modules', 'node-xsl-schematron');
const XSLT3_BIN = path.join(ROOT_DIR, 'node_modules', 'xslt3', 'xslt3.js');
const PIPELINE_XSL = path.join(
  NODE_XSL_SCHEMATRON_DIR,
  'lib',
  'schxslt-1.9.5',
  '2.0',
  'pipeline-for-svrl.xsl',
);
const RESULTS_XSL = path.join(NODE_XSL_SCHEMATRON_DIR, 'lib', 'results.xsl');

const RUNTIME_STYLESHEETS = [
  {
    outputFileName: 'results.sef.json',
    stylesheetPath: RESULTS_XSL,
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
await assertPathExists(PIPELINE_XSL, 'Schematron pipeline stylesheet');
await Promise.all(
  RUNTIME_STYLESHEETS.map(({ stylesheetPath, outputFileName }) =>
    assertPathExists(stylesheetPath, `${outputFileName} source stylesheet`),
  ),
);

await fs.mkdir(RUNTIME_DIR, { recursive: true });
await ensureBrowserRuntime();
await Promise.all([
  ...RUNTIME_STYLESHEETS.map(({ outputFileName, stylesheetPath }) =>
    compileRuntimeAsset(outputFileName, stylesheetPath),
  ),
  writeSchemaRegistry(),
  removeIfExists(path.join(RUNTIME_DIR, 'pipeline-for-svrl.sef.json')),
  removeIfExists(path.join(RUNTIME_DIR, 'runner.sef.json')),
]);

async function assertPathExists(filePath, label) {
  try {
    await fs.access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${label} was not found at ${filePath}. Run "npm install" before building.`);
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

async function compileSchemaValidator(fileName, schematron) {
  const schemaBaseName = path.parse(fileName).name;
  const outputFileName = `${schemaBaseName}.sef.json`;
  const outputPath = path.join(VALIDATORS_DIR, outputFileName);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'schematron-validator-'));
  const schemaPath = path.join(temporaryDirectory, fileName);
  const stylesheetPath = path.join(temporaryDirectory, `${schemaBaseName}.xsl`);

  await fs.writeFile(schemaPath, schematron, 'utf8');

  try {
    await execFileAsync(process.execPath, [
      XSLT3_BIN,
      `-xsl:${PIPELINE_XSL}`,
      `-s:${schemaPath}`,
      `-o:${stylesheetPath}`,
    ]);
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
        ? `Failed generating validator bundle for ${fileName}.\n${details}`
        : `Failed generating validator bundle for ${fileName}.`,
    );
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }

  return `runtime/validators/${outputFileName}`;
}

async function ensureBrowserRuntime() {
  try {
    await fs.access(SAXON_JS_RUNTIME, constants.F_OK);
    return;
  } catch {}

  const response = await fetch(SAXON_JS_RUNTIME_URL);

  if (!response.ok) {
    throw new Error(
      `Failed downloading SaxonJS browser runtime from ${SAXON_JS_RUNTIME_URL}. ` +
        `Received ${response.status} ${response.statusText}.`,
    );
  }

  await fs.writeFile(SAXON_JS_RUNTIME, Buffer.from(await response.arrayBuffer()));
}

async function removeIfExists(filePath) {
  await fs.rm(filePath, { force: true });
}

async function writeSchemaRegistry() {
  const files = (await fs.readdir(SCHEMAS_DIR)).filter((file) => file.endsWith('.sch')).sort();
  const schemas = [];

  await fs.rm(VALIDATORS_DIR, { recursive: true, force: true });
  await fs.mkdir(VALIDATORS_DIR, { recursive: true });

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
      validatorAsset: await compileSchemaValidator(fileName, schematron),
      title,
      documentType: namespaceToDocumentType(namespaceUri),
      namespaceUri,
      profileIds: unique([
        ...collectTokenizedMatches(PROFILE_TOKENIZE_REGEX, schematron),
        ...collectMatches(PROFILE_EXACT_REGEX, schematron),
      ]),
      customizationIds: unique(collectMatches(CUSTOMIZATION_EXACT_REGEX, schematron)),
      customizationPrefixes: unique(collectMatches(CUSTOMIZATION_PREFIX_REGEX, schematron)),
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
