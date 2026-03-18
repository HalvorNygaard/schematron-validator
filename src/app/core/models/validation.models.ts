export interface ValidationIssue {
  id: string;
  severity: string;
  message: string;
  location: string;
  test: string;
}

export interface ValidationSummary {
  total: number;
  fatalCount: number;
  warningCount: number;
  otherCount: number;
}

export interface ValidationDocument {
  rootElement: string;
  customizationId: string | null;
  profileId: string | null;
  hasXmlDeclaration: boolean;
}

export interface MatchedSchema {
  transactionCode: string;
  fileName: string;
  title: string;
  documentType: string;
  namespaceUri: string;
  profileIds: string[];
  customizationPatterns: string[];
}

export interface ValidationResponse {
  document: ValidationDocument;
  schema: MatchedSchema;
  issues: ValidationIssue[];
  summary: ValidationSummary;
}
