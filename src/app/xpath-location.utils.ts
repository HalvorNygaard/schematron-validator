export type XPathSegment = {
  localName: string;
  predicate: string | null;
  namespace: string | null;
};

/** Known namespace URI → short prefix map for common XML vocabularies. */
const NS_PREFIXES: Record<string, string> = {
  'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2': 'ubl',
  'urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2': 'ubl',
  'urn:oasis:names:specification:ubl:schema:xsd:Order-2': 'ubl',
  'urn:oasis:names:specification:ubl:schema:xsd:OrderResponse-2': 'ubl',
  'urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2': 'ubl',
  'urn:oasis:names:specification:ubl:schema:xsd:Catalogue-2': 'ubl',
  'urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2': 'ubl',
  'urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2': 'cac',
  'urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2': 'cbc',
  'urn:oasis:names:specification:ubl:schema:xsd:CommonExtensionComponents-2': 'ext',
  'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100': 'udt',
  'urn:un:unece:uncefact:data:standard:QualifiedDataType:100': 'qdt',
};

// Matches a single XPath step: Q{ns}LocalName[predicate] or plain LocalName[predicate]
const STEP_PATTERN = /Q\{([^}]*)\}([\w.-]+)(?:\[(\d+)\])?|([\w.-]+)(?:\[(\d+)\])?/g;

/**
 * Parses an XPath location string (SaxonJS EQName / Clark notation) into
 * structured segments so the UI can render it clearly.
 *
 * Input:  /Q{urn:oasis:...OrderResponse-2}OrderResponse[1]/Q{urn:...cac}BillingReference[1]
 * Output: [{ localName: 'OrderResponse', predicate: '1', namespace: 'urn:...' }, ...]
 */
export function parseXPathLocation(xpath: string): XPathSegment[] {
  if (!xpath?.trim()) {
    return [];
  }

  const segments: XPathSegment[] = [];
  STEP_PATTERN.lastIndex = 0;

  for (const match of xpath.matchAll(STEP_PATTERN)) {
    const [, qNs, qLocal, qPred, plainLocal, plainPred] = match;

    if (qLocal) {
      segments.push({
        localName: qLocal,
        predicate: qPred ?? null,
        namespace: qNs || null,
      });
    } else if (plainLocal) {
      segments.push({
        localName: plainLocal,
        predicate: plainPred ?? null,
        namespace: null,
      });
    }
  }

  return segments;
}

/** Returns the short namespace prefix for a URI, or null if unknown. */
export function namespacePrefix(uri: string): string | null {
  return NS_PREFIXES[uri] ?? null;
}
