import { describe, expect, it } from 'vitest';

import { matchRuntimeSchema, type RuntimeSchema } from './schema-selection.utils';

const peppolOrderResponse: RuntimeSchema = {
  id: 'peppol-order-response',
  documentType: 'OrderResponse',
  namespaceUri: 'urn:oasis:names:specification:ubl:schema:xsd:OrderResponse-2',
  profileIds: ['urn:fdc:peppol.eu:poacc:bis:ordering:3'],
  customizationIds: [],
  customizationPrefixes: ['urn:fdc:peppol.eu:poacc:trns:order_response:3'],
};

const ehfOrderResponse: RuntimeSchema = {
  id: 'ehf-order-response',
  documentType: 'OrderResponse',
  namespaceUri: 'urn:oasis:names:specification:ubl:schema:xsd:OrderResponse-2',
  profileIds: ['urn:fdc:anskaffelser.no:2019:ehf:postaward:g3:02:1.0'],
  customizationIds: [
    'urn:fdc:peppol.eu:poacc:trns:order_response:3:extended:urn:fdc:anskaffelser.no:2019:ehf:spec:3.0',
  ],
  customizationPrefixes: [],
};

describe('schema selection', () => {
  it('prefers the plain Peppol schema for a plain Peppol order response', () => {
    const document = {
      rootElement: 'OrderResponse',
      namespaceUri: 'urn:oasis:names:specification:ubl:schema:xsd:OrderResponse-2',
      customizationId: 'urn:fdc:peppol.eu:poacc:trns:order_response:3',
      profileId: 'urn:fdc:peppol.eu:poacc:bis:ordering:3',
    };

    expect(matchRuntimeSchema(document, [peppolOrderResponse, ehfOrderResponse]).id).toBe(
      'peppol-order-response',
    );
  });

  it('matches the EHF reminder stack only when identifiers align', () => {
    const reminderSchema: RuntimeSchema = {
      id: 'ehf-reminder',
      documentType: 'Invoice',
      namespaceUri: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      profileIds: ['urn:fdc:anskaffelser.no:2019:ehf:postaward:g3:06:1.0'],
      customizationIds: [
        'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0#conformant#urn:fdc:anskaffelser.no:2019:ehf:reminder:3.0',
      ],
      customizationPrefixes: [],
    };

    const paymentRequestSchema: RuntimeSchema = {
      id: 'ehf-payment-request',
      documentType: 'Invoice',
      namespaceUri: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      profileIds: ['urn:fdc:anskaffelser.no:2019:ehf:postaward:g3:07:1.0'],
      customizationIds: ['urn:fdc:anskaffelser.no:2019:ehf:spec:payment-request:3.0'],
      customizationPrefixes: [],
    };

    const document = {
      rootElement: 'Invoice',
      namespaceUri: 'urn:oasis:names:specification:ubl:schema:xsd:Invoice-2',
      customizationId:
        'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0#conformant#urn:fdc:anskaffelser.no:2019:ehf:reminder:3.0',
      profileId: 'urn:fdc:anskaffelser.no:2019:ehf:postaward:g3:06:1.0',
    };

    expect(matchRuntimeSchema(document, [paymentRequestSchema, reminderSchema]).id).toBe(
      'ehf-reminder',
    );
  });

  it('rejects the right local name when the namespace does not match', () => {
    const wrongNamespaceDocument = {
      rootElement: 'OrderResponse',
      namespaceUri: 'urn:example:unexpected',
      customizationId: null,
      profileId: null,
    };

    expect(() => matchRuntimeSchema(wrongNamespaceDocument, [peppolOrderResponse])).toThrow(
      "No schematron mapping exists for root element 'OrderResponse'.",
    );
  });

  it('rejects ambiguous matches when identifiers are too weak to separate candidates', () => {
    const sharedNamespace = 'urn:oasis:names:specification:ubl:schema:xsd:ApplicationResponse-2';
    const candidates: RuntimeSchema[] = [
      {
        id: 'candidate-a',
        documentType: 'ApplicationResponse',
        namespaceUri: sharedNamespace,
        profileIds: [],
        customizationIds: [],
        customizationPrefixes: ['urn:test:shared'],
      },
      {
        id: 'candidate-b',
        documentType: 'ApplicationResponse',
        namespaceUri: sharedNamespace,
        profileIds: [],
        customizationIds: [],
        customizationPrefixes: ['urn:test:shared'],
      },
    ];

    expect(() =>
      matchRuntimeSchema(
        {
          rootElement: 'ApplicationResponse',
          namespaceUri: sharedNamespace,
          customizationId: 'urn:test:shared:doc',
          profileId: null,
        },
        candidates,
      ),
    ).toThrow('Multiple schematron files matched ApplicationResponse.');
  });
});
