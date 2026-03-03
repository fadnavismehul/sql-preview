import type {
  ColumnDef,
  QueryPage,
  ConnectorType,
  BaseConnectionProfile,
  TrinoConnectionProfile,
  PostgresConnectionProfile,
  SQLiteConnectionProfile,
  CustomConnectionProfile,
  ConnectionProfile,
  ConnectorConfig,
  MSSQLConnectionProfile,
  SnowflakeConnectionProfile,
  BigQueryConnectionProfile,
} from '@sql-preview/connector-api';

export type {
  ColumnDef,
  QueryPage,
  ConnectorType,
  BaseConnectionProfile,
  TrinoConnectionProfile,
  PostgresConnectionProfile,
  SQLiteConnectionProfile,
  CustomConnectionProfile,
  ConnectionProfile,
  ConnectorConfig,
  MSSQLConnectionProfile,
  SnowflakeConnectionProfile,
  BigQueryConnectionProfile,
};

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
  supportsPagination?: boolean | undefined;
}

export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
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

  // Remote/MCP specific
  isRemote?: boolean;
  sessionId?: string;
  remoteId?: string | undefined;
  supportsPagination?: boolean | undefined;
}

// (Connector types are now exported from @sql-preview/connector-api above)

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
  | { command: 'lockMcpPort'; port: number }
  | { command: 'openExtensionPage' }
  | { command: 'testMcpServer'; port?: number }
  | { command: 'logMessage'; level: string; message: string };

export type ExtensionToWebviewMessage =
  | {
      type: 'createTab';
      tabId: string;
      query: string;
      title: string;
      sourceFileUri?: string | undefined;
      preserveFocus?: boolean;
      index?: number;
    }
  | { type: 'resultData'; tabId: string; data: QueryResults; title: string }
  | {
      type: 'queryError';
      tabId: string;
      error: { message: string; details?: string | undefined };
      query?: string | undefined;
      title?: string | undefined;
    }
  | {
      type: 'queryCancelled';
      tabId: string;
      message?: string;
    }
  | {
      type: 'showLoading';
      tabId: string;
      query?: string | undefined;
      title?: string | undefined;
      preserveFocus?: boolean;
    }
  | { type: 'statusMessage'; message: string }
  | {
      type: 'reuseOrCreateActiveTab';
      tabId: string;
      query: string;
      title: string;
      sourceFileUri?: string | undefined;
      preserveFocus?: boolean;
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
  | {
      type: 'testMcpResult';
      success: boolean;
      error?: string | undefined;
      message?: string | undefined;
    }
  | { type: 'updateConfig'; config: unknown }
  | {
      type: 'updateVersionInfo';
      currentVersion: string;
      latestVersion: string | null;
    };
