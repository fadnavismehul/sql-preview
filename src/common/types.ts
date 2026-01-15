export interface ColumnDef {
  name: string;
  type: string;
}

export interface QueryPage {
  columns?: ColumnDef[] | undefined;
  data: unknown[][];
  nextUri?: string | undefined;
  infoUri?: string | undefined;
  id?: string | undefined;
  stats?:
    | {
        state: string;
        [key: string]: any;
      }
    | undefined;
}

export interface QueryResults {
  columns: ColumnDef[];
  rows: unknown[][];
  query: string;
  wasTruncated: boolean;
  totalRowsInFirstBatch: number;
  // Optional metadata
  queryId?: string | undefined;
  infoUri?: string | undefined;
  nextUri?: string | undefined;
}

export interface TabData {
  id: string;
  title: string;
  query: string;
  columns: ColumnDef[];
  rows: unknown[][];
  status: 'created' | 'loading' | 'success' | 'error';
  error?: string | undefined;
  errorDetails?: string | undefined;
  wasTruncated?: boolean | undefined;
  totalRowsInFirstBatch?: number | undefined;
  queryId?: string | undefined;
  infoUri?: string | undefined;
  nextUri?: string | undefined;
  sourceFileUri?: string | undefined;
  wasDataCleared?: boolean | undefined;
}

/**
 * Configuration for a connector.
 */
export interface ConnectorConfig {
  host: string;
  port: number;
  user: string;
  catalog?: string | undefined;
  schema?: string | undefined;
  ssl: boolean;
  sslVerify: boolean;
  maxRows: number;
  password?: string | undefined;
}

// --- Messages ---

export type WebviewToExtensionMessage =
  | { command: 'alert'; text: string }
  | { command: 'createNewTab' }
  | { command: 'showInfo'; text: string }
  | { command: 'showError'; text: string }
  | { command: 'exportResults'; tabId: string }
  | { command: 'webviewLoaded' }
  | { command: 'tabClosed'; tabId: string }
  | {
      command: 'updateTabState';
      tabId: string;
      title?: string | undefined;
      query?: string | undefined;
    }
  | { command: 'tabSelected'; tabId: string }
  | { command: 'cancelQuery'; tabId: string };

export type ExtensionToWebviewMessage =
  | {
      type: 'createTab';
      tabId: string;
      query: string;
      title: string;
      sourceFileUri?: string | undefined;
    }
  | { type: 'resultData'; tabId: string; data: QueryResults; title: string }
  | {
      type: 'queryError';
      tabId: string;
      error: { message: string; details?: string | undefined };
      query?: string | undefined;
      title?: string | undefined;
    }
  | { type: 'showLoading'; tabId: string; query?: string | undefined; title?: string | undefined }
  | { type: 'statusMessage'; message: string }
  | {
      type: 'reuseOrCreateActiveTab';
      tabId: string;
      query: string;
      title: string;
      sourceFileUri?: string | undefined;
    }
  | { type: 'closeActiveTab' }
  | { type: 'closeTab'; tabId: string }
  | { type: 'closeOtherTabs' }
  | { type: 'closeAllTabs' }
  | { type: 'updateFontSize'; fontSize: string }
  | { type: 'filterTabs'; fileUri?: string | undefined; fileName?: string | undefined }
  | { type: 'updateRowHeight'; density: string };
