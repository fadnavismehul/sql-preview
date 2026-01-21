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
        [key: string]: unknown;
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
/**
 * Connection Configuration Types
 */
export type ConnectorType = 'trino' | 'postgres';

export interface BaseConnectionProfile {
  id: string;
  name: string;
  type: ConnectorType;
  host: string;
  port: number;
  user: string;
  password?: string; // Optional: runtime only, not persisted plain-text in some contexts
  ssl: boolean;
  sslVerify?: boolean; // Defaults to true
}

export interface TrinoConnectionProfile extends BaseConnectionProfile {
  type: 'trino';
  catalog?: string;
  schema?: string;
  customAuthHeader?: string;
}

export interface PostgresConnectionProfile extends BaseConnectionProfile {
  type: 'postgres';
  database: string;
}

export type ConnectionProfile = TrinoConnectionProfile | PostgresConnectionProfile;

/**
 * Legacy Configuration for backward compatibility (maps to Trino)
 */
export interface ConnectorConfig {
  host: string;
  port: number;
  user: string;
  catalog?: string;
  schema?: string;
  ssl: boolean;
  sslVerify: boolean;
  maxRows: number;
  password?: string;
  // New: Source Profile ID
  connectionId?: string;
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
  | { command: 'cancelQuery'; tabId: string }
  | { command: 'refreshConnections' }
  | { command: 'saveConnection'; profile: ConnectionProfile }
  | { command: 'deleteConnection'; id: string }
  | { command: 'testConnection'; config: unknown } // Config is effectively loose for test
  | { command: 'refreshSettings' }
  | { command: 'saveSettings'; settings: unknown }
  | { command: 'setPassword' }
  | { command: 'clearPassword' }
  | { command: 'logMessage'; level: string; message: string };

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
  | { type: 'updateRowHeight'; density: string }
  | { type: 'updateConnections'; connections: ConnectionProfile[] }
  | { type: 'testConnectionResult'; success: boolean; error?: string }
  | { type: 'updateConfig'; config: unknown };
