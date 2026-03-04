import React, { useEffect, useRef } from 'react';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
// Import VS Code dataviewer styles
import '../../../webviews/results/theme.css';
import '../../../webviews/results/resultsView.css';
// @ts-ignore
import resultsViewRawCode from '../../../webviews/results/resultsView.js?raw';
import * as agGrid from 'ag-grid-community';

// In AG Grid v32+ with ES Modules (Vite), modules must be explicitly registered
// before createGrid works, otherwise it fails silently or returns undefined
import { ModuleRegistry, ClientSideRowModelModule, ValidationModule, TextFilterModule, NumberFilterModule, DateFilterModule, CustomFilterModule, PaginationModule } from 'ag-grid-community';

// Try AllCommunityModule if it exists, otherwise register individual used ones:
// Actually ag-grid v35 has AllCommunityModule.
if ((agGrid as any).AllCommunityModule) {
    ModuleRegistry.registerModules([(agGrid as any).AllCommunityModule]);
} else {
    // Fallback for older explicit list
    ModuleRegistry.registerModules([ClientSideRowModelModule, ValidationModule, TextFilterModule, NumberFilterModule, DateFilterModule, CustomFilterModule, PaginationModule]);
}

// Provide global agGrid so resultsView.js can find it, just like in VS Code webview
(window as any).agGrid = agGrid;

interface QueryResult {
    query: string;
    columns: Array<{ name: string; type: string }>;
    rows: Array<any[]>;
    rowCount: number;
    executionTime: number;
    connection: string;
}

export function McpResultsView({ theme, latestResult }: { theme: 'light' | 'dark', latestResult?: QueryResult | null }) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
    const modifierKey = isMac ? 'Cmd' : 'Ctrl';
    const scriptLoaded = useRef(false);

    useEffect(() => {
        if (!scriptLoaded.current) {
            scriptLoaded.current = true;
            const script = document.createElement('script');
            script.textContent = resultsViewRawCode;
            document.body.appendChild(script);
        }
    }, []);

    // Sync theme to body so the VS Code CSS variables take effect
    useEffect(() => {
        document.body.classList.remove('vscode-light', 'vscode-dark');
        document.body.classList.add(`vscode-${theme}`);
    }, [theme]);

    // When the MCP app receives new data, translate it into the message format resultsView.js expects
    useEffect(() => {
        if (!latestResult) return;

        const tabId = `mcp-tab-${Date.now()}`;

        // 1. Create Tab
        window.postMessage({
            type: 'createTab',
            tabId,
            query: latestResult.query,
            title: `Result`,
            preserveFocus: false
        }, '*');

        // 2. Send Result Data
        window.postMessage({
            type: 'resultData',
            tabId,
            title: `Result`,
            data: {
                query: latestResult.query,
                columns: latestResult.columns,
                rows: latestResult.rows,
                queryId: `mcp-query-${Date.now()}`
            }
        }, '*');
    }, [latestResult]);

    return (
        <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative' }}>
            <div id="main-view" className="view-container">
                <div id="tab-container" className="tab-container">
                    <div id="tab-list" className="tab-list" role="tablist" aria-label="Query Results Tabs"></div>
                    <div id="active-file-indicator" className="active-file-indicator" style={{ display: 'none' }} role="status" aria-live="polite"></div>
                    <button id="connections-button" className="icon-button" title="Manage Connections" aria-label="Manage Connections" style={{ background: 'none', border: 'none', color: 'var(--color-text)', cursor: 'pointer', padding: '4px' }}>
                        {/* We hide the connection button here since the MCP app already has a Connections tab */}
                    </button>
                </div>

                <div id="tab-content-container" className="tab-content-container">
                    <div id="no-tabs-message" className="no-tabs-message">
                        <p>Execute a SQL query to create your first results tab</p>
                        <p className="shortcut-hint" style={{ display: 'none' }}>
                            <span className="key">{modifierKey}</span> + <span className="key">Enter</span>
                        </p>
                    </div>
                </div>
            </div>

            {/* Context Menu */}
            <div id="tab-context-menu" className="context-menu">
                <div className="context-menu-item" id="ctx-copy-query">Copy Query</div>
                <div className="context-menu-separator" style={{ height: '1px', background: 'var(--vscode-menu-separatorBackground, #ccc)', margin: '4px 0' }}></div>
                <div className="context-menu-item" id="ctx-close">Close</div>
                <div className="context-menu-item" id="ctx-close-others">Close Others</div>
                <div className="context-menu-item" id="ctx-close-all">Close All</div>
            </div>

            {/* Inject minimal VS Code css variables if missing so resultsView.js renders nicely */}
            <style>{`
                body.vscode-light {
                    --vscode-editor-background: var(--color-bg, #ffffff);
                    --vscode-editor-foreground: var(--color-text, #333333);
                    --vscode-tab-inactiveBackground: #ececec;
                    --vscode-tab-activeBackground: #ffffff;
                    --vscode-tab-activeForeground: #333333;
                    --vscode-tab-border: #cccccc;
                    --vscode-focusBorder: #007fd4;
                    --vscode-badge-background: #007acc;
                    --vscode-badge-foreground: #ffffff;
                    --vscode-input-background: #ffffff;
                    --vscode-input-foreground: #333333;
                    --vscode-input-border: #cecece;
                    --vscode-button-background: #007acc;
                    --vscode-button-foreground: #ffffff;
                    --vscode-scrollbarSlider-background: rgba(100, 100, 100, 0.4);
                }
                body.vscode-dark {
                    --vscode-editor-background: var(--color-bg, #1e1e1e);
                    --vscode-editor-foreground: var(--color-text, #cccccc);
                    --vscode-tab-inactiveBackground: #2d2d2d;
                    --vscode-tab-activeBackground: #1e1e1e;
                    --vscode-tab-activeForeground: #ffffff;
                    --vscode-tab-border: #252526;
                    --vscode-focusBorder: #007fd4;
                    --vscode-badge-background: #4d4d4d;
                    --vscode-badge-foreground: #ffffff;
                    --vscode-input-background: #3c3c3c;
                    --vscode-input-foreground: #cccccc;
                    --vscode-input-border: #3c3c3c;
                    --vscode-button-background: #0e639c;
                    --vscode-button-foreground: #ffffff;
                    --vscode-scrollbarSlider-background: rgba(121, 121, 121, 0.4);
                }
                
                #connections-button { display: none !important; } /* MCP has own nav */
            `}</style>
        </div>
    );
}
