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

  async function validate(xml) {
    const document = parseDocument(xml);
    const schemas = await loadSchemaRegistry();
    const schema = matchSchema(document, schemas);
    const validator = await compileValidator(schema);
    const rawIssues = await runValidator(validator, xml);
    const issues = rawIssues.map(normalizeIssue).sort(compareSeverity);

    return {
      document,
      schema: toPublicSchema(schema),
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

  async function compileValidator(schema) {
    const cached = runtimeState.validatorPromises.get(schema.transactionCode);
    if (!cached) {
      runtimeState.validatorPromises.set(schema.transactionCode, loadValidator(schema));
    }

    return runtimeState.validatorPromises.get(schema.transactionCode);
  }

  async function loadValidator(schema) {
    return fetchJson(schema.validatorAsset);
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
      customizationId: getFirstElementText(root, 'CustomizationID'),
      profileId: getFirstElementText(root, 'ProfileID'),
      hasXmlDeclaration: true,
    };
  }

  function getFirstElementText(root, localName) {
    const element = Array.from(root.children).find((child) => child.localName === localName);
    return element?.textContent?.trim() || null;
  }

  function matchSchema(document, schemas) {
    const candidates = schemas.filter((schema) => schema.documentType === document.rootElement);

    if (!candidates.length) {
      throw new Error(`No schematron mapping exists for root element '${document.rootElement}'.`);
    }

    if (candidates.length === 1) {
      return candidates[0];
    }

    const scored = candidates
      .map((schema) => ({ schema, score: scoreSchema(schema, document) }))
      .sort((left, right) => right.score - left.score);

    const winner = scored[0];
    const runnerUp = scored[1];

    if (!winner || winner.score < 0) {
      throw new Error(
        `No schematron matched ${document.rootElement} with the provided CustomizationID/ProfileID.`,
      );
    }

    if (runnerUp && winner.score === runnerUp.score) {
      throw new Error(
        `Multiple schematron files matched ${document.rootElement}. Provide a more specific CustomizationID/ProfileID.`,
      );
    }

    return winner.schema;
  }

  function scoreSchema(schema, document) {
    let score = 10;

    if (document.customizationId) {
      if (schema.customizationIds.includes(document.customizationId)) {
        score += 120;
      } else if (
        schema.customizationPrefixes.some((prefix) => document.customizationId.startsWith(prefix))
      ) {
        score += 110;
      } else if (schema.customizationIds.length || schema.customizationPrefixes.length) {
        score -= 90;
      }
    }

    if (document.profileId) {
      if (schema.profileIds.includes(document.profileId)) {
        score += 80;
      } else if (schema.profileIds.length) {
        score -= 60;
      }
    }

    return score;
  }

  function normalizeIssue(issue) {
    return {
      id: typeof issue.id === 'string' ? issue.id : 'unknown',
      severity: typeof issue.flag === 'string' ? issue.flag.toLowerCase() : 'info',
      message: typeof issue.text === 'string' ? issue.text : 'Schematron assertion failed.',
      location: typeof issue.location === 'string' ? issue.location : '',
      test: typeof issue.test === 'string' ? issue.test : '',
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
      transactionCode: schema.transactionCode,
      fileName: schema.fileName,
      title: schema.title,
      documentType: schema.documentType,
      namespaceUri: schema.namespaceUri,
      profileIds: schema.profileIds,
      customizationPatterns: [...schema.customizationIds, ...schema.customizationPrefixes],
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
