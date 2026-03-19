export interface ValidationIssue {
  id: string;
  severity: string;
  message: string;
  location: string;
  test: string;
  source: string;
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
  id: string;
  source: string;
  displayTitle: string;
  schematrons: Array<{
    fileName: string;
    title: string;
  }>;
}

export interface ValidationResponse {
  document: ValidationDocument;
  schema: MatchedSchema;
  issues: ValidationIssue[];
  summary: ValidationSummary;
}
