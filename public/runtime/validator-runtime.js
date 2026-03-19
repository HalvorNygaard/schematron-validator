(function () {
  const SaxonJS = window.SaxonJS;

  if (!SaxonJS) {
    throw new Error('SaxonJS browser runtime failed to load.');
  }

  const runtimeState = {
    schemaRegistryPromise: null,
    resultsPromise: null,
    validatorPromises: new Map(),
  };

  window.saxonJsValidator = {
    validate,
  };

  function matchRuntimeSchema(document, schemas) {
    const rootMatches = schemas.filter(
      (schema) =>
        schema.documentType === document.rootElement &&
        (!document.namespaceUri ||
          !schema.namespaceUri ||
          schema.namespaceUri === document.namespaceUri),
    );

    if (!rootMatches.length) {
      throw new Error(`No schematron mapping exists for root element '${document.rootElement}'.`);
    }

    const customizationMatches = narrowByCustomization(rootMatches, document.customizationId);
    const profileMatches = narrowByProfile(customizationMatches, document.profileId);

    if (!profileMatches.length) {
      throw new Error(
        `No schematron matched ${document.rootElement} with the provided CustomizationID/ProfileID.`,
      );
    }

    if (profileMatches.length > 1) {
      throw new Error(
        `Multiple schematron files matched ${document.rootElement}. Provide a more specific CustomizationID/ProfileID.`,
      );
    }

    return profileMatches[0];
  }

  function narrowByCustomization(schemas, customizationId) {
    if (!customizationId) {
      return schemas;
    }

    const exactMatches = schemas.filter((schema) =>
      schema.customizationIds.includes(customizationId),
    );
    if (exactMatches.length) {
      return exactMatches;
    }

    const prefixMatches = schemas.filter((schema) =>
      schema.customizationPrefixes.some((prefix) => customizationId.startsWith(prefix)),
    );
    if (prefixMatches.length) {
      return prefixMatches;
    }

    return schemas.filter(
      (schema) => !schema.customizationIds.length && !schema.customizationPrefixes.length,
    );
  }

  function narrowByProfile(schemas, profileId) {
    if (!profileId) {
      return schemas;
    }

    const exactMatches = schemas.filter((schema) => schema.profileIds.includes(profileId));
    if (exactMatches.length) {
      return exactMatches;
    }

    return schemas.filter((schema) => !schema.profileIds.length);
  }

  async function validate(xml) {
    const document = parseDocument(xml);
    const profiles = await loadSchemaRegistry();
    const profile = matchRuntimeSchema(document, profiles);
    const validators = await loadValidators(profile);
    const issues = await collectIssues(validators, profile.schematrons, xml);

    return {
      document,
      schema: toPublicSchema(profile),
      issues,
      summary: summarizeIssues(issues),
    };
  }

  async function loadSchemaRegistry() {
    runtimeState.schemaRegistryPromise ??= fetchJson('runtime/schema-registry.json');
    return runtimeState.schemaRegistryPromise;
  }

  async function loadResultsTransformer() {
    runtimeState.resultsPromise ??= fetchJson('runtime/results.sef.json');
    return runtimeState.resultsPromise;
  }

  async function loadValidators(schema) {
    const cached = runtimeState.validatorPromises.get(schema.id);
    if (!cached) {
      runtimeState.validatorPromises.set(
        schema.id,
        Promise.all(schema.schematrons.map(loadValidator)),
      );
    }

    return runtimeState.validatorPromises.get(schema.id);
  }

  async function loadValidator(schematron) {
    return fetchJson(schematron.validatorAsset);
  }

  async function runValidator(validator, xml) {
    const resultsTransformer = await loadResultsTransformer();
    const { principalResult: svrlDocument } = await SaxonJS.transform(
      {
        stylesheetInternal: validator,
        sourceText: xml,
        destination: 'document',
      },
      'async',
    );

    const { principalResult } = await SaxonJS.transform(
      {
        stylesheetInternal: resultsTransformer,
        sourceNode: svrlDocument,
        destination: 'raw',
        resultForm: 'array',
      },
      'async',
    );

    return Array.isArray(principalResult) ? principalResult : [];
  }

  async function collectIssues(validators, schematrons, xml) {
    const issues = [];

    for (let index = 0; index < validators.length; index += 1) {
      const rawIssues = await runValidator(validators[index], xml);
      issues.push(...rawIssues.map((issue) => normalizeIssue(issue, schematrons[index])));
    }

    return issues.sort(compareSeverity);
  }

  function parseDocument(xml) {
    const declaration = xml.match(/^\s*<\?xml[\s\S]*?\?>/i)?.[0] ?? null;

    if (!declaration) {
      throw new Error(
        'XML declaration is required. Start the document with <?xml version="1.0" encoding="utf-8"?>.',
      );
    }

    if (!/encoding\s*=\s*["']utf-8["']/i.test(declaration)) {
      throw new Error('The XML declaration must include UTF-8 encoding.');
    }

    const parser = new DOMParser();
    const parsed = parser.parseFromString(xml, 'application/xml');

    if (parsed.querySelector('parsererror')) {
      throw new Error('The XML document could not be parsed.');
    }

    const root = parsed.documentElement;
    if (!root) {
      throw new Error('No document root element was found.');
    }

    return {
      rootElement: root.localName,
      namespaceUri: root.namespaceURI ?? null,
      customizationId: getFirstElementText(root, 'CustomizationID'),
      profileId: getFirstElementText(root, 'ProfileID'),
      hasXmlDeclaration: true,
    };
  }

  function getFirstElementText(root, localName) {
    const element = Array.from(root.children).find((child) => child.localName === localName);
    return element?.textContent?.trim() || null;
  }

  function normalizeIssue(issue, schematron) {
    return {
      id: typeof issue.id === 'string' ? issue.id : 'unknown',
      severity: typeof issue.flag === 'string' ? issue.flag.toLowerCase() : 'info',
      message: typeof issue.text === 'string' ? issue.text : 'Schematron assertion failed.',
      location: typeof issue.location === 'string' ? issue.location : '',
      test: typeof issue.test === 'string' ? issue.test : '',
      source: schematron?.title ?? schematron?.fileName ?? '',
    };
  }

  function summarizeIssues(issues) {
    return issues.reduce(
      (summary, issue) => {
        summary.total += 1;
        if (issue.severity === 'fatal') {
          summary.fatalCount += 1;
        } else if (issue.severity === 'warning') {
          summary.warningCount += 1;
        } else {
          summary.otherCount += 1;
        }
        return summary;
      },
      { total: 0, fatalCount: 0, warningCount: 0, otherCount: 0 },
    );
  }

  function compareSeverity(left, right) {
    const order = { fatal: 0, warning: 1, info: 2 };
    return (order[left.severity] ?? 3) - (order[right.severity] ?? 3);
  }

  function toPublicSchema(schema) {
    return {
      id: schema.id,
      source: schema.source,
      displayTitle: schema.displayTitle || schema.title,
      schematrons: schema.schematrons.map((schematron) => ({
        fileName: schematron.fileName,
        title: schematron.title,
      })),
    };
  }

  async function fetchJson(relativePath) {
    const response = await fetch(new URL(relativePath, document.baseURI));
    if (!response.ok) {
      throw new Error(`Failed loading runtime asset: ${relativePath}`);
    }

    return response.json();
  }
})();
