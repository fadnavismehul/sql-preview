import { useRef, useState, useEffect } from 'react';
import type { App as McpApp, McpUiHostContext } from '@modelcontextprotocol/ext-apps';
import { useApp } from '@modelcontextprotocol/ext-apps/react';
import { McpResultsView } from './components/McpResultsView';
import { ConnectionsManager } from './components/ConnectionsManager';
import { Toolbar } from './components/Toolbar';
import { StatusBar } from './components/StatusBar';
import { EmptyState } from './components/EmptyState';
import { ErrorToast } from './components/ErrorToast';
import { QueryPreview } from './components/QueryPreview';
import './styles/theme.css';

interface QueryResult {
    query: string;
    columns: Array<{ name: string; type: string }>;
    rows: Array<any[]>;
    rowCount: number;
    executionTime: number;
    connection: string;
}

function extractQueryResult(rawData: unknown): QueryResult | null {
    if (!rawData || typeof rawData !== 'object') return null;
    const d = rawData as Record<string, unknown>;
    if (!Array.isArray(d.columns) || !Array.isArray(d.rows)) return null;
    return d as unknown as QueryResult;
}

function normalizeQueryResult(data: QueryResult, sql: string): QueryResult {
    if ((!data.columns || data.columns.length === 0) && data.rows.length > 0) {
        const firstRow = data.rows[0];
        if (Array.isArray(firstRow)) {
            data.columns = (firstRow as unknown[]).map((_, i) => ({ name: `col${i}`, type: 'text' }));
        } else if (typeof firstRow === 'object' && firstRow !== null) {
            data.columns = Object.keys(firstRow as object).map(key => ({
                name: key,
                type: typeof (firstRow as Record<string, unknown>)[key] === 'number' ? 'number' : 'text',
            }));
        }
    }
    if (data.rows.length > 0 && data.columns.length > 0) {
        const colNames = data.columns.map(c => c.name);
        data.rows = data.rows.map(row => {
            if (Array.isArray(row)) {
                return row; // Keep as array
            }
            if (typeof row === 'object' && row !== null) {
                // Convert object to array based on columns order
                return colNames.map(name => (row as Record<string, unknown>)[name]);
            }
            return [row]; // Fallback
        });
    }
    data.query = sql;
    return data;
}

export function App() {
    const [hostContext, setHostContext] = useState<McpUiHostContext | undefined>();
    const [result, setResult] = useState<QueryResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sql, setSql] = useState('SELECT 1');
    const [isLoading, setIsLoading] = useState(false);
    const [view, setView] = useState<'query' | 'connections'>('query');
    const [isAppMode, setIsAppMode] = useState(false);
    const appendDebug = (msg: string) => console.log(`[MCP UI Debug] ${msg}`);

    const appRef = useRef<McpApp | null>(null);

    const { app, error: appError } = useApp({
        appInfo: { name: 'SQL Preview', version: '1.0.0' },
        capabilities: {},
        onAppCreated: (createdApp) => {
            appRef.current = createdApp;
            appendDebug('onAppCreated');

            createdApp.onhostcontextchanged = (params) => {
                appendDebug(`hostContextChanged: ${JSON.stringify(params).slice(0, 80)}`);
                setHostContext(prev => ({ ...prev, ...params }));
            };

            createdApp.ontoolinput = async (params) => {
                const args = params.arguments as Record<string, unknown> | undefined;
                appendDebug(`ontoolinput: sql=${String(args?.sql ?? '').slice(0, 40)}`);
                if (!args?.sql) return;
                const toolSql = args.sql as string;
                setIsAppMode(true);
                setIsLoading(true);
                setError(null);
                try {
                    const callResult = await createdApp.callServerTool({
                        name: 'run_query',
                        arguments: {
                            sql: toolSql,
                            session: (args.session as string) || 'mcp-app-session',
                            connectionId: args.connectionId as string | undefined,
                        },
                    });
                    setIsLoading(false);
                    if (callResult.isError) {
                        const text = callResult.content?.find(c => c.type === 'text')?.text as string | undefined;
                        setError(text ?? 'Query failed');
                        return;
                    }
                    const qr = extractQueryResult(callResult.structuredContent);
                    appendDebug(`callServerTool result: ${qr ? `${qr.rows.length} rows` : 'no data'}`);
                    if (qr) { setResult(normalizeQueryResult(qr, toolSql)); setError(null); }
                } catch (e) { setError(String(e)); setIsLoading(false); }
            };

            createdApp.ontoolresult = (params) => {
                appendDebug(`ontoolresult: isError=${String(params.isError)} hasStructured=${String(!!params.structuredContent)}`);
                setIsLoading(false);
                setIsAppMode(true);
                if (params.isError) {
                    const text = params.content?.find(c => c.type === 'text')?.text as string | undefined;
                    setError(text ?? 'Tool execution failed');
                    return;
                }
                const qr = extractQueryResult(params.structuredContent);
                if (qr) { setResult(normalizeQueryResult(qr, sql)); setError(null); }
            };

            createdApp.ontoolcancelled = () => {
                appendDebug('ontoolcancelled');
                setIsLoading(false);
            };
        },
    });

    // After app connects, capture first hostContext and log toolInfo
    const [connected, setConnected] = useState(false);
    if (app && !connected) {
        setConnected(true);
        const ctx = app.getHostContext();
        if (ctx) {
            setHostContext(ctx);
            appendDebug(`connected toolInfo=${JSON.stringify(ctx.toolInfo ?? null).slice(0, 80)}`);
        } else {
            appendDebug('connected: no hostContext');
        }
    }

    // Get initial theme from URL to prevent FOUC before connection is fully established
    const initialThemeParam = new URLSearchParams(window.location.search).get('theme');
    const initialTheme = (initialThemeParam === 'dark' || initialThemeParam === 'light') ? initialThemeParam : 'light';
    const theme = hostContext?.theme ?? initialTheme;

    useEffect(() => {
        if (theme === 'dark') {
            document.body.classList.remove('light-theme', 'vscode-light');
            document.body.classList.add('dark-theme', 'vscode-dark');
        } else {
            document.body.classList.remove('dark-theme', 'vscode-dark');
            document.body.classList.add('light-theme', 'vscode-light');
        }
    }, [theme]);

    const copyTextSafe = async (text: string) => {
        try {
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
                return;
            }
        } catch (e) {
            console.warn('navigator.clipboard failed, using fallback', e);
        }

        // Fallback for non-secure contexts (like Claude Desktop local iframe sometimes)
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
            document.execCommand('copy');
        } catch (error) {
            console.error('Fallback copy failed', error);
        }
        textArea.remove();
    };

    const handleRunQuery = async () => {
        if (!app) return;
        setIsLoading(true);
        setError(null);
        try {
            const callResult = await app.callServerTool({ name: 'run_query', arguments: { sql, session: 'mcp-app-manual' } });
            setIsLoading(false);
            if (callResult.isError) {
                const text = callResult.content?.find(c => c.type === 'text')?.text as string | undefined;
                setError(text ?? 'Query failed');
                return;
            }
            const qr = extractQueryResult(callResult.structuredContent);
            if (qr) { setResult(normalizeQueryResult(qr, sql)); setError(null); }
        } catch (e) { setError(String(e)); setIsLoading(false); }
    };

    const handleCopy = () => {
        if (!result || result.rows.length === 0) return;
        const header = result.columns.map(c => c.name).join('\t');
        const tsvRows = result.rows.map(row => result.columns.map((c, i) => String(row[i] ?? '')).join('\t'));
        copyTextSafe([header, ...tsvRows].join('\n'));
    };

    if (appError) return <div style={{ padding: 16, color: 'red' }}>Connection error: {appError.message}</div>;
    if (!app) return <div style={{ padding: 16 }}>Connecting...</div>;

    return (
        <div className="app-container">
            {!isAppMode && (
                <div className="nav-bar">
                    <button className={`nav-item ${view === 'query' ? 'active' : ''}`} onClick={() => setView('query')}>Query</button>
                    <button className={`nav-item ${view === 'connections' ? 'active' : ''}`} onClick={() => setView('connections')}>Connections</button>
                </div>
            )}



            <div className="content">
                <ErrorToast message={error} onDismiss={() => setError(null)} />
                <div className="main-content">
                    {view === 'query' ? (
                        <div className="grid-wrapper">
                            {!isAppMode && (
                                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                    <textarea
                                        className="form-input sql-editor"
                                        placeholder="Type SQL manually or ask Claude to query..."
                                        value={sql}
                                        onChange={e => setSql(e.target.value)}
                                        style={{ marginBottom: 'var(--spacing-sm)' }}
                                    />
                                    <button className="btn btn-primary" onClick={handleRunQuery} disabled={isLoading || !app}>
                                        Run Query
                                    </button>
                                </div>
                            )}
                            <Toolbar onCopy={handleCopy} />
                            {result && <StatusBar rowCount={result.rowCount ?? result.rows.length} executionTime={result.executionTime ?? 0} connectionName={result.connection} />}
                            <QueryPreview sql={result?.query ?? sql} />
                            <div className="grid-container">
                                {isLoading ? (
                                    <div className="loading-state"><div className="spinner" /><p>Executing query...</p></div>
                                ) : result ? (
                                    <McpResultsView theme={theme as 'light' | 'dark'} latestResult={result} />
                                ) : (
                                    <EmptyState />
                                )}
                            </div>
                        </div>
                    ) : (
                        <ConnectionsManager app={app} theme={theme} />
                    )}
                </div>
            </div>
        </div>
    );
}
