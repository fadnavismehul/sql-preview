import * as vscode from 'vscode';
import { getNonce } from '../../../utils/nonce';

/**
 * Responsible for generating the HTML content for the Results Webview.
 */
export class ResultsHtmlGenerator {
  constructor(private readonly _extensionUri: vscode.Uri) {}

  public getHtmlForWebview(webview: vscode.Webview): string {
    const nonce = getNonce();
    // Local Vendor Assets for AG Grid (Community)
    const agGridScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'media',
        'vendor',
        'ag-grid',
        'ag-grid-community.min.js'
      )
    );
    const agGridStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'vendor', 'ag-grid', 'ag-grid.min.css')
    );
    const agGridThemeStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this._extensionUri,
        'media',
        'vendor',
        'ag-grid',
        'ag-theme-quartz.min.css'
      )
    );

    const csp = `
        default-src 'none'; 
        script-src 'nonce-${nonce}' ${webview.cspSource};
        style-src ${webview.cspSource} 'unsafe-inline';
        font-src ${webview.cspSource} https: data:;
        img-src ${webview.cspSource} https: data:;
        connect-src https://sentry.io ${webview.cspSource};
    `;

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.js')
    );
    const stylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'resultsView.css')
    );
    const themeStylesUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'webviews', 'results', 'theme.css')
    );
    const customFontSize = vscode.workspace
      .getConfiguration('sqlPreview')
      .get<number>('fontSize', 0);

    return `<!DOCTYPE html>
		<html lang="en">
		<head>
			<meta charset="UTF-8">
			<meta http-equiv="Content-Security-Policy" content="${csp}">
			<meta name="viewport" content="width=device-width, initial-scale=1.0">
			<link href="${agGridStylesUri}" rel="stylesheet">
			<link href="${agGridThemeStylesUri}" rel="stylesheet">
            <link href="${themeStylesUri}" rel="stylesheet">
			<link href="${stylesUri}" rel="stylesheet">
            <style nonce="${nonce}">
                :root {
					${customFontSize > 0 ? `font-size: ${customFontSize}px;` : ''}
				}
            </style>
			<title>SQL Preview Results</title>
		</head>
		<body>
			<!-- Main View: Tabs and Results -->
            <div id="main-view" class="view-container">
                <div id="tab-container" class="tab-container">
                    <div id="tab-list" class="tab-list" role="tablist" aria-label="Query Results Tabs"></div>
                    <div id="active-file-indicator" class="active-file-indicator" style="display:none;"></div>
                    <button id="connections-button" class="icon-button" title="Manage Connections" aria-label="Manage Connections" style="background:none;border:none;color:var(--vscode-foreground);cursor:pointer;padding:4px;">
                        <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path d="M9.1 4.4L8.6 2H7.4l-.5 2.4-.7.3-2-1.3-.9.8 1.3 2-.2.7-2.4.5v1.2l2.4.5.3.8-1.3 2 .8.8 2-1.3.8.3.4 2.4h1.2l.5-2.4.8-.3 2 1.3.8-.8-1.3-2 .3-.8 2.3-.4V7.4l-2.4-.5-.3-.8 1.3-2-.8-.8-2 1.3-.7-.2zM8 11c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3-1.3 3-3 3z"/></svg>
                    </button>
                </div>
                
                <div id="tab-content-container" class="tab-content-container">
                    <div id="no-tabs-message" class="no-tabs-message">
                        <p>Execute a SQL query to create your first results tab</p>
                    </div>
                </div>
            </div>

            <!-- Settings View -->
            <div id="settings-view" class="view-container" style="display:none;">
                <div class="settings-view-content">
                    <div class="manager-header">
                        <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
                            <div style="display:flex;align-items:center;gap:15px;">
                                <button id="close-settings" class="icon-button" title="Back to Results" aria-label="Back to Results">
                                    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="M7.78 2.22a.75.75 0 0 1 0 1.06L4.56 6.5h8.69a.75.75 0 0 1 0 1.5H4.56l3.22 3.22a.75.75 0 1 1-1.06 1.06l-4.5-4.5a.75.75 0 0 1 0-1.06l4.5-4.5a.75.75 0 0 1 1.06 0z"/></svg>
                                </button>
                                <h2>Settings</h2>
                            </div>
                             <div class="version-info" id="version-info-container" style="display: flex; align-items: center; gap: 10px;">
                                <div style="text-align: right;">
                                    <div class="version-header" style="font-weight: 600; font-size: 13px;">SQL Preview <span id="version-number" style="opacity: 0.8; font-weight: normal;"></span></div>
                                    <div id="version-status" class="version-status" style="font-size: 11px; opacity: 0.7;">Checking for updates...</div>
                                </div>
                                <button id="update-btn" class="primary-button small" style="display:none; padding: 4px 8px; font-size: 11px;">Update</button>
                            </div>
                        </div>
                    </div>
                    <div class="settings-grid">
                        <!-- Left Column: User Preferences -->
                        <div class="settings-column">
                            <h3>User Preferences</h3>
                            
                            <div class="form-row">
                                <div class="form-group" style="flex:1;">
                                    <label for="cfg-maxRowsToDisplay">Max Rows</label>
                                    <input type="number" id="cfg-maxRowsToDisplay" placeholder="500">
                                </div>
                                <div class="form-group" style="flex:1;">
                                    <label for="cfg-fontSize">Font Size (px)</label>
                                    <input type="number" id="cfg-fontSize" placeholder="Inherit">
                                </div>
                            </div>
                            
                            <div class="form-row">
                                <div class="form-group" style="flex:1;">
                                    <label for="cfg-rowHeight">Row Height</label>
                                    <select id="cfg-rowHeight">
                                        <option value="compact">Compact</option>
                                        <option value="normal">Normal</option>
                                        <option value="comfortable">Comfortable</option>
                                    </select>
                                </div>
                                <div class="form-group" style="flex:1;">
                                    <label for="cfg-tabNaming">Tab Naming</label>
                                    <select id="cfg-tabNaming">
                                        <option value="query-snippet">Query Content</option>
                                        <option value="file-sequential">Sequential</option>
                                    </select>
                                </div>
                            </div>
                            
                        </div>

                        <!-- Right Column: System Settings -->
                        <div class="settings-column">
                            <h3>System Settings</h3>
                            
                            <!-- Connection Card -->
                            <div class="settings-card">
                                <div class="card-header">
                                    <h4>Database Connection</h4>
                                    <span class="card-subtitle">Configure your default connection.</span>
                                </div>
                                
                                <div class="card-content">
                                    <div class="form-group">
                                        <label for="cfg-defaultConnector">Connector Type</label>
                                        <select id="cfg-defaultConnector">
                                            <option value="trino">Trino / Presto</option>
                                            <option value="sqlite">SQLite</option>
                                        </select>
                                    </div>

                                    <!-- Trino Fields -->
                                    <div id="cfg-group-trino" class="connector-group">
                                        <div class="form-group">
                                            <label for="cfg-host">Host</label>
                                            <input type="text" id="cfg-host" placeholder="localhost">
                                        </div>

                                        <div class="form-row">
                                            <div class="form-group" style="flex:1;">
                                                <label for="cfg-port">Port</label>
                                                <input type="number" id="cfg-port" value="8080">
                                            </div>
                                            <div class="form-group" style="flex:2;">
                                                <label for="cfg-user">User</label>
                                                <input type="text" id="cfg-user" placeholder="admin">
                                            </div>
                                        </div>

                                        <div class="form-row">
                                            <div class="form-group" style="flex:1;">
                                                <label for="cfg-catalog">Catalog</label>
                                                <input type="text" id="cfg-catalog" placeholder="Optional">
                                            </div>
                                            <div class="form-group" style="flex:1;">
                                                <label for="cfg-schema">Schema</label>
                                                <input type="text" id="cfg-schema" placeholder="Optional">
                                            </div>
                                        </div>

                                        <div class="form-group">
                                            <label>Password</label>
                                            <div class="input-with-actions">
                                                <span id="password-status" class="status-badge">(Checking...)</span>
                                                <button id="set-password-btn" class="primary-button">Set</button>
                                                <button id="clear-password-btn" class="danger-button">Clear</button>
                                            </div>
                                        </div>

                                        <div class="checkbox-row">
                                            <label><input type="checkbox" id="cfg-ssl"> Enable SSL</label>
                                            <label><input type="checkbox" id="cfg-sslVerify"> Verify Cert</label>
                                        </div>
                                    </div>

                                    <!-- SQLite Fields -->
                                    <div id="cfg-group-sqlite" class="connector-group" style="display:none;">
                                        <div class="form-group">
                                            <label for="cfg-databasePath">Database Path</label>
                                            <input type="text" id="cfg-databasePath" placeholder="/path/to/database.db">
                                            <small style="color:var(--vscode-descriptionForeground);display:block;margin-top:4px;">Absolute path to the SQLite file.</small>
                                        </div>
                                    </div>

                                    <div class="form-group" style="margin-top: 15px;">
                                        <button id="test-connection-btn" class="primary-button" style="width: auto;">Test Connection</button>
                                        <span id="test-connection-status" class="status-badge" style="margin-left: 10px;"></span>
                                    </div>
                                </div>
                            </div>

                            <!-- MCP Server Card -->
                            <div class="settings-card mcp-server">
                                <div class="card-header">
                                    <h4>MCP Server</h4>
                                </div>
                                <div class="card-content">
                                    <!-- No warning callout -->

                                    <div class="form-row align-center" style="margin-top:10px;">
                                        <label class="toggle-label"><input type="checkbox" id="cfg-mcpEnabled"> Enable MCP Server</label>
                                        <div class="form-group horizontal" style="margin-left:auto;">
                                            <span style="color:var(--vscode-descriptionForeground);">Port: <strong>8414</strong></span>
                                        </div>
                                    </div>

                                    <div class="mcp-info">
                                        <div class="form-group" style="margin-bottom: 8px;">
                                            <label>Connection URL</label>
                                            <div class="code-snippet">
                                                <pre id="mcp-snippet" style="text-align: left; white-space: pre;">{
    "sql-preview": {
      "type": "streamable-http",
      "url": "http://localhost:8414/mcp"
    }
}</pre>
                                                <button id="copy-mcp-config" class="icon-button" title="Copy Config" aria-label="Copy MCP Config">📋</button>
                                            </div>
                                        </div>
                                        <p style="font-size: 0.9em; color: var(--vscode-descriptionForeground); margin: 8px 0;">
                                            Connect Claude, Cursor, or other AI agents to this running server. 
                                            Ask them to use the preview server, it should use the <code>run_query</code> tool.
                                            Once a query has been executed, you can ask the agent to read the results which uses the <code>get_tab_info</code> tool.
                                        </p>
                                        <div style="font-size: 0.8em; opacity: 0.8; margin-top: 4px;">
                                            <strong>Tools:</strong> run_query, get_tab_info, list_sessions, cancel_query
                                        </div>
                                    </div>
                                    
                                        <button id="test-mcp-btn" class="primary-button" style="width: auto;">Test MCP Server</button>
                                        <span id="test-mcp-status" class="status-badge"></span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="tab-context-menu" class="context-menu">
                <div class="context-menu-item" id="ctx-copy-query">Copy Query</div>
                <div class="context-menu-separator" style="height:1px; background:var(--vscode-menu-separatorBackground); margin:4px 0;"></div>
                <div class="context-menu-item" id="ctx-close">Close</div>
                <div class="context-menu-item" id="ctx-close-others">Close Others</div>
                <div class="context-menu-item" id="ctx-close-all">Close All</div>
            </div>
			<script nonce="${nonce}" src="${agGridScriptUri}"></script>
			<script nonce="${nonce}" src="${scriptUri}"></script>
		</body>
		</html>`;
  }
}
