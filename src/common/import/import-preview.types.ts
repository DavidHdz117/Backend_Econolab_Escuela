export type ImportPreviewAction = 'create' | 'update' | 'skip';

export interface ImportPreviewRow {
  rowNumber: number;
  action: ImportPreviewAction;
  duplicate: boolean;
  duplicateSource?: 'database' | 'file';
  summary: string;
  matchLabel?: string | null;
  errors: string[];
  raw: Record<string, string>;
}

export interface ImportPreviewSummary {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  toCreate: number;
  toUpdate: number;
  skipped: number;
  duplicatesInFile: number;
  duplicatesInDatabase: number;
}

export interface ImportPreviewResult {
  message: string;
  headers: string[];
  summary: ImportPreviewSummary;
  rows: ImportPreviewRow[];
}
