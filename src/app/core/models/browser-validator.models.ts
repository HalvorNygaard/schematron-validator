export interface BrowserValidationIssue {
  id?: string;
  flag?: string;
  text?: string;
  location?: string;
  test?: string;
}

export interface BrowserSchemaDefinition {
  transactionCode: string;
  fileName: string;
  title: string;
  documentType: string;
  namespaceUri: string;
  profileIds: string[];
  customizationIds: string[];
  customizationPrefixes: string[];
  schematron: string;
}
