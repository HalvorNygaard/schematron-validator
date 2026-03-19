export type RuntimeSchema = {
  id: string;
  documentType: string;
  namespaceUri: string;
  profileIds: string[];
  customizationIds: string[];
  customizationPrefixes: string[];
};

export type RuntimeDocument = {
  rootElement: string;
  namespaceUri: string | null;
  customizationId: string | null;
  profileId: string | null;
};

export function matchRuntimeSchema(
  document: RuntimeDocument,
  schemas: RuntimeSchema[],
): RuntimeSchema {
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

function narrowByCustomization(
  schemas: RuntimeSchema[],
  customizationId: string | null,
): RuntimeSchema[] {
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

  const unconstrainedSchemas = schemas.filter(
    (schema) => !schema.customizationIds.length && !schema.customizationPrefixes.length,
  );
  return unconstrainedSchemas;
}

function narrowByProfile(schemas: RuntimeSchema[], profileId: string | null): RuntimeSchema[] {
  if (!profileId) {
    return schemas;
  }

  const exactMatches = schemas.filter((schema) => schema.profileIds.includes(profileId));
  if (exactMatches.length) {
    return exactMatches;
  }

  const unconstrainedSchemas = schemas.filter((schema) => !schema.profileIds.length);
  return unconstrainedSchemas;
}
