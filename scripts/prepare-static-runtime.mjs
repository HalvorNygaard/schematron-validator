import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMAS_DIR = path.join(ROOT_DIR, 'Schemas');
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const RUNTIME_DIR = path.join(ROOT_DIR, 'public', 'runtime');
const VALIDATORS_DIR = path.join(RUNTIME_DIR, 'validators');
const SCHEMA_REGISTRY_PATH = path.join(SCHEMAS_DIR, 'registry.json');
const PREPARE_CACHE_PATH = path.join(RUNTIME_DIR, 'prepare-runtime-cache.json');
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
const TITLE_REGEX = /<title\b[^>]*>([\s\S]*?)<\/title>/i;
const NS_DECLARATION_REGEX = /<ns\b([^>]*?)\/>/gi;
const ATTRIBUTE_REGEX = /(prefix|uri)="([^"]+)"/gi;
const PREPARE_CACHE_VERSION = 1;
const DOCUMENT_TYPE_NAMESPACES = {
  ApplicationResponse: 'urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2',
  Catalogue: 'urn:oasis:names:specification:ubl:schema:xsd:Catalogue-2',
  CatalogueResponse: 'urn:oasis:names:specification:ubl:schema:xsd:CatalogueResponse-2',
  CreditNote: 'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2',
  DespatchAdvice: 'urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2',
  Invoice: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
  Order: 'urn:oasis:names:specification:ubl:schema:xsd:Order-2',
  OrderCancellation: 'urn:oasis:names:specification:ubl:schema:xsd:OrderCancellation-2',
  OrderChange: 'urn:oasis:names:specification:ubl:schema:xsd:OrderChange-2',
  OrderResponse: 'urn:oasis:names:specification:ubl:schema:xsd:OrderResponse-2',
};

await assertPathExists(SCHEMAS_DIR, 'Schemas directory');
await assertPathExists(SCHEMA_REGISTRY_PATH, 'Schemas registry');
await assertPathExists(XSLT3_BIN, 'xslt3 CLI');
await assertPathExists(PIPELINE_XSL, 'Schematron pipeline stylesheet');
await assertPathExists(RESULTS_XSL, 'Results stylesheet');

await fs.mkdir(RUNTIME_DIR, { recursive: true });
const prepareCache = await loadPrepareCache();
await ensureBrowserRuntime();
await Promise.all([
  compileRuntimeAsset('results.sef.json', RESULTS_XSL, prepareCache, 'results-transformer'),
  writeSchemaRegistry(prepareCache),
  removeIfExists(path.join(RUNTIME_DIR, 'pipeline-for-svrl.sef.json')),
  removeIfExists(path.join(RUNTIME_DIR, 'runner.sef.json')),
]);
await savePrepareCache(prepareCache);

async function assertPathExists(filePath, label) {
  try {
    await fs.access(filePath, constants.F_OK);
  } catch {
    throw new Error(`${label} was not found at ${filePath}. Run "npm install" before building.`);
  }
}

async function compileRuntimeAsset(outputFileName, stylesheetPath, prepareCache, cacheKey) {
  const outputPath = path.join(RUNTIME_DIR, outputFileName);
  const stylesheet = await fs.readFile(stylesheetPath, 'utf8');
  const inputHash = hashContent(`runtime:${cacheKey}\n${stylesheet}`);

  if (await canReuseCompiledAsset(outputPath, prepareCache.assets[cacheKey], inputHash)) {
    prepareCache.assets[cacheKey] = inputHash;
    return;
  }

  try {
    await execFileAsync(process.execPath, [
      XSLT3_BIN,
      `-xsl:${stylesheetPath}`,
      `-export:${outputPath}`,
      '-nogo',
    ]);
  } catch (error) {
    throw new Error(formatExecError(error, `Failed generating ${outputFileName}.`));
  }

  prepareCache.assets[cacheKey] = inputHash;
}

async function compileSchemaValidator(filePath, outputKey, prepareCache) {
  const normalizedOutputKey = outputKey.replace(/\\/g, '/');
  const outputPath = path.join(VALIDATORS_DIR, `${normalizedOutputKey}.sef.json`);
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'schematron-validator-'));
  const schemaPath = path.join(temporaryDirectory, path.basename(filePath));
  const stylesheetPath = path.join(temporaryDirectory, `${path.parse(filePath).name}.xsl`);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const originalSchema = await fs.readFile(filePath, 'utf8');
  const normalizedSchema = normalizeSchematronForCompilation(originalSchema);
  const pipeline = await fs.readFile(PIPELINE_XSL, 'utf8');
  const inputHash = hashContent(
    `validator:${normalizedOutputKey}\n${normalizedSchema}\n${pipeline}`,
  );

  if (
    await canReuseCompiledAsset(outputPath, prepareCache.validators[normalizedOutputKey], inputHash)
  ) {
    prepareCache.validators[normalizedOutputKey] = inputHash;
    return `runtime/validators/${normalizedOutputKey}.sef.json`;
  }

  await fs.writeFile(schemaPath, normalizedSchema);

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
    throw new Error(formatExecError(error, `Failed generating validator bundle for ${filePath}.`));
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
  }

  prepareCache.validators[normalizedOutputKey] = inputHash;

  return `runtime/validators/${normalizedOutputKey}.sef.json`;
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

async function writeSchemaRegistry(prepareCache) {
  const manifest = await readSchemaManifest();
  await fs.mkdir(VALIDATORS_DIR, { recursive: true });

  const schemas = [];
  const expectedValidatorAssets = new Set();
  for (const entry of manifest) {
    const schema = await createSchemaRegistryEntry(entry, prepareCache);
    schema.schematrons.forEach((schematron) =>
      expectedValidatorAssets.add(schematron.validatorAsset),
    );
    schemas.push(schema);
  }

  await writeFileIfChanged(
    path.join(RUNTIME_DIR, 'schema-registry.json'),
    `${JSON.stringify(schemas, null, 2)}\n`,
  );
  await removeObsoleteValidatorAssets(expectedValidatorAssets, prepareCache);
}

async function createSchemaRegistryEntry(entry, prepareCache) {
  const schematrons = await compileManifestSchematrons(entry, prepareCache);
  const primarySchematron = schematrons[0];

  return {
    id: entry.id,
    source: entry.source,
    displayTitle: entry.displayTitle || primarySchematron.title,
    transactionCode: entry.transactionCode,
    title: primarySchematron.title,
    documentType: entry.documentType,
    namespaceUri: primarySchematron.namespaceUri,
    profileIds: entry.profileIds,
    customizationIds: entry.customizationIds,
    customizationPrefixes: entry.customizationPrefixes,
    schematrons,
  };
}

async function compileManifestSchematrons(entry, prepareCache) {
  const compiledSchematrons = [];

  for (let index = 0; index < entry.schematrons.length; index += 1) {
    const fileName = entry.schematrons[index];
    const schematronPath = path.join(SCHEMAS_DIR, fileName);
    await assertPathExists(schematronPath, `Schematron file ${fileName}`);

    const schematronSource = await fs.readFile(schematronPath, 'utf8');
    const { title, namespaceUri } = extractSchemaMetadata(schematronSource, entry, schematronPath);

    compiledSchematrons.push({
      fileName,
      title,
      namespaceUri,
      validatorAsset: await compileSchemaValidator(
        schematronPath,
        buildValidatorKey(entry, index),
        prepareCache,
      ),
    });
  }

  return compiledSchematrons;
}

async function readSchemaManifest() {
  const manifest = JSON.parse(await fs.readFile(SCHEMA_REGISTRY_PATH, 'utf8'));

  if (!Array.isArray(manifest)) {
    throw new Error('Schemas/registry.json must contain an array of schema definitions.');
  }

  return manifest.map(validateManifestEntry);
}

function validateManifestEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    throw new Error('Each schema manifest entry must be an object.');
  }

  if (typeof entry.id !== 'string' || !entry.id.trim()) {
    throw new Error('Each schema manifest entry must define a non-empty id.');
  }

  if (typeof entry.source !== 'string' || !entry.source.trim()) {
    throw new Error(`Schema manifest entry ${entry.id} must define source.`);
  }

  if (typeof entry.documentType !== 'string' || !entry.documentType.trim()) {
    throw new Error(`Schema manifest entry ${entry.id} must define documentType.`);
  }

  const schematrons = normalizeSchematronArray(entry.schematrons, `${entry.id} schematrons`);
  if (!schematrons.length) {
    throw new Error(`Schema manifest entry ${entry.id} must define at least one schematron file.`);
  }

  const profileIds = normalizeStringArray(entry.profileIds, `${entry.id} profileIds`);
  const customizationIds = normalizeStringArray(
    entry.customizationIds,
    `${entry.id} customizationIds`,
  );
  const customizationPrefixes = normalizeStringArray(
    entry.customizationPrefixes,
    `${entry.id} customizationPrefixes`,
  );

  if (!profileIds.length && !customizationIds.length && !customizationPrefixes.length) {
    throw new Error(
      `Schema manifest entry ${entry.id} must define at least one profileId, customizationId, or customizationPrefix.`,
    );
  }

  return {
    id: entry.id.trim(),
    source: entry.source.trim(),
    displayTitle:
      typeof entry.displayTitle === 'string' && entry.displayTitle.trim()
        ? entry.displayTitle.trim()
        : '',
    transactionCode:
      typeof entry.transactionCode === 'string' && entry.transactionCode.trim()
        ? entry.transactionCode.trim()
        : entry.id.trim(),
    documentType: entry.documentType.trim(),
    schematrons,
    profileIds,
    customizationIds,
    customizationPrefixes,
  };
}

function normalizeSchematronArray(value, label) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== 'string' || !item.endsWith('.sch'))
  ) {
    throw new Error(`${label} must be an array of .sch file paths.`);
  }

  return value.map((item) => item.replace(/\\/g, '/').trim()).filter(Boolean);
}

function normalizeStringArray(value, label) {
  if (value === undefined) {
    return [];
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

function buildValidatorKey(entry, index) {
  return `${entry.id}/${String(index + 1).padStart(2, '0')}`;
}

async function loadPrepareCache() {
  try {
    const raw = await fs.readFile(PREPARE_CACHE_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (parsed?.version === PREPARE_CACHE_VERSION) {
      return {
        version: PREPARE_CACHE_VERSION,
        assets: parsed.assets && typeof parsed.assets === 'object' ? parsed.assets : {},
        validators:
          parsed.validators && typeof parsed.validators === 'object' ? parsed.validators : {},
      };
    }
  } catch {}

  return {
    version: PREPARE_CACHE_VERSION,
    assets: {},
    validators: {},
  };
}

async function savePrepareCache(prepareCache) {
  await writeFileIfChanged(PREPARE_CACHE_PATH, `${JSON.stringify(prepareCache, null, 2)}\n`);
}

async function canReuseCompiledAsset(outputPath, cachedHash, inputHash) {
  if (!cachedHash || cachedHash !== inputHash) {
    return false;
  }

  try {
    await fs.access(outputPath, constants.F_OK);
  } catch {
    return false;
  }

  return true;
}

async function writeFileIfChanged(filePath, content) {
  try {
    const existing = await fs.readFile(filePath, 'utf8');
    if (existing === content) {
      return;
    }
  } catch {}

  await fs.writeFile(filePath, content);
}

async function removeObsoleteValidatorAssets(expectedValidatorAssets, prepareCache) {
  const existingFiles = await listFilesRecursively(VALIDATORS_DIR);

  for (const filePath of existingFiles) {
    const relativePath = path.relative(PUBLIC_DIR, filePath).replace(/\\/g, '/');
    if (!expectedValidatorAssets.has(relativePath)) {
      await fs.rm(filePath, { force: true });
    }
  }

  for (const key of Object.keys(prepareCache.validators)) {
    const assetPath = `runtime/validators/${key}.sef.json`;
    if (!expectedValidatorAssets.has(assetPath)) {
      delete prepareCache.validators[key];
    }
  }
}

async function listFilesRecursively(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(entryPath)));
    } else {
      files.push(entryPath);
    }
  }

  return files;
}

function hashContent(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeSchematronForCompilation(source) {
  const firstPatternIndex = source.search(/<pattern\b/i);
  if (firstPatternIndex === -1) {
    return source;
  }

  const beforeFirstPattern = source.slice(0, firstPatternIndex);
  const afterFirstPattern = source.slice(firstPatternIndex);
  const lateFunctions = afterFirstPattern.match(/<function\b[\s\S]*?<\/function>/gi);

  if (!lateFunctions?.length) {
    return source;
  }

  const withoutLateFunctions = afterFirstPattern.replace(
    /<function\b[\s\S]*?<\/function>\s*/gi,
    '',
  );
  return `${beforeFirstPattern}${lateFunctions.join('\n')}${withoutLateFunctions}`;
}

function extractSchemaMetadata(schematron, entry, schematronPath) {
  const title =
    cleanXmlText(schematron.match(TITLE_REGEX)?.[1]) ??
    `${entry.transactionCode} (${path.basename(schematronPath, '.sch')})`;
  const namespaceUri = findNamespaceUri(schematron, entry.documentType);

  if (!namespaceUri) {
    throw new Error(
      `Failed to parse schema namespace from ${path.relative(SCHEMAS_DIR, schematronPath)}`,
    );
  }

  return { title, namespaceUri };
}

function cleanXmlText(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized || null;
}

function findNamespaceUri(schematron, documentType) {
  const declarations = [];

  for (const match of schematron.matchAll(NS_DECLARATION_REGEX)) {
    const attributes = Object.fromEntries(
      [...match[1].matchAll(ATTRIBUTE_REGEX)].map(([, key, value]) => [
        key.toLowerCase(),
        value.trim(),
      ]),
    );

    if (attributes.prefix && attributes.uri) {
      declarations.push(attributes);
    }
  }

  const preferredPrefixes = getPreferredPrefixes(documentType);
  for (const prefix of preferredPrefixes) {
    const declaration = declarations.find((item) => item.prefix === prefix);
    if (declaration?.uri) {
      return declaration.uri;
    }
  }

  return DOCUMENT_TYPE_NAMESPACES[documentType] ?? null;
}

function getPreferredPrefixes(documentType) {
  switch (documentType) {
    case 'ApplicationResponse':
      return ['ubl', 'ubl-applicationresponse'];
    case 'Catalogue':
      return ['ubl', 'ubl-catalogue'];
    case 'CatalogueResponse':
      return ['ubl', 'ubl-catalogueresponse'];
    case 'CreditNote':
      return ['ubl', 'ubl-creditnote', 'cn'];
    case 'DespatchAdvice':
      return ['ubl', 'ubl-despatchadvice'];
    case 'Invoice':
      return ['ubl', 'ubl-invoice', 'invoice'];
    case 'Order':
      return ['ubl', 'ubl-order'];
    case 'OrderCancellation':
      return ['ubl', 'ubl-ordercancellation'];
    case 'OrderChange':
      return ['ubl', 'ubl-orderchange'];
    case 'OrderResponse':
      return ['ubl', 'ubl-orderresponse'];
    default:
      return ['ubl'];
  }
}

function formatExecError(error, fallbackMessage) {
  const details = [error?.stdout, error?.stderr].filter(Boolean).join('\n').trim();
  return details ? `${fallbackMessage}\n${details}` : fallbackMessage;
}
