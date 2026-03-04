import { useEffect, useState } from 'react';
import { useMcpApp } from './hooks/useMcpApp';
import { ResultsGrid } from './components/ResultsGrid';
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
    rows: Array<Record<string, unknown>>;
    rowCount: number;
    executionTime: number;
    connection: string;
}

export function App() {
    const { app, theme } = useMcpApp();
    const [result, setResult] = useState<QueryResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [sql, setSql] = useState('SELECT 1');
    const [isLoading, setIsLoading] = useState(false);
    const [view, setView] = useState<'query' | 'connections'>('query');

    useEffect(() => {
        if (!app) { return; }

        app.ontoolresult = (toolResult) => {
            setIsLoading(false);
            if (toolResult.data) {
                setResult(toolResult.data as QueryResult);
                setError(null);
            } else if (toolResult.isError) {
                setError(String(toolResult.content || 'Unknown error'));
            }
        };
    }, [app]);

    const handleRunQuery = async () => {
        if (!app) { return; }
        setIsLoading(true);
        setError(null);
        try {
            const result = await app.callServerTool({ name: 'run_query', arguments: { sql: sql, waitForResult: true } });
            if (result.data) {
                const data = result.data as QueryResult;

                if ((!data.columns || data.columns.length === 0) && data.rows.length > 0) {
                    const firstRow = data.rows[0];
                    if (Array.isArray(firstRow)) {
                        data.columns = firstRow.map((_, index) => ({ name: `col${index}`, type: 'text' }));
                    } else {
                        data.columns = Object.keys(firstRow).map(key => ({
                            name: key,
                            type: typeof firstRow[key] === 'number' ? 'number' : 'text'
                        }));
                    }
                }

                if (data.rows.length > 0 && Array.isArray(data.rows[0]) && data.columns.length > 0) {
                    const columnNames = data.columns.map(c => c.name);
                    data.rows = data.rows.map((row) => {
                        if (Array.isArray(row)) {
                            const rowObj: Record<string, unknown> = {};
                            row.forEach((val, idx) => {
                                if (idx < columnNames.length) {
                                    rowObj[columnNames[idx]] = val;
                                }
                            });
                            return rowObj;
                        }
                        return row as Record<string, unknown>;
                    });
                }

                data.query = sql; // Attach query for QueryPreview
                setResult(data);
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.error('Query Error:', e);
            setError(String(e));
        } finally {
            setIsLoading(false);
        }
    };

    const handleExportCsv = () => {
        if (!result || result.rows.length === 0) return;
        const header = result.columns.map(c => c.name).join(',');
        const csvRows = result.rows.map(row =>
            result.columns.map(c => JSON.stringify(row[c.name] ?? '')).join(',')
        );
        const tsv = [header, ...csvRows].join('\n');

        // Fallback to clipboard since iframe might block blob downloads
        navigator.clipboard.writeText(tsv).then(() => {
            // Can show a transient toast here in the future
        });
    };

    const handleCopy = () => {
        if (!result || result.rows.length === 0) return;
        const header = result.columns.map(c => c.name).join('\t');
        const tsvRows = result.rows.map(row =>
            result.columns.map(c => String(row[c.name] ?? '')).join('\t')
        );
        const tsv = [header, ...tsvRows].join('\n');
        navigator.clipboard.writeText(tsv);
    };

    return (
        <div className={`app-container ${theme === 'dark' ? 'dark-theme' : ''}`}>
            {/* Header Navigation */}
            <div className="nav-bar">
                <button
                    className={`nav-item ${view === 'query' ? 'active' : ''}`}
                    onClick={() => setView('query')}
                >
                    Query
                </button>
                <button
                    className={`nav-item ${view === 'connections' ? 'active' : ''}`}
                    onClick={() => setView('connections')}
                >
                    Connections
                </button>
            </div>

            {/* Application Content */}
            <div className="content">
                <ErrorToast message={error} onDismiss={() => setError(null)} />

                {view === 'connections' ? (
                    <ConnectionsManager app={app} theme={theme} />
                ) : (
                    <>
                        {result || isLoading ? (
                            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                                <Toolbar
                                    onRerun={handleRunQuery}
                                    onExportCsv={handleExportCsv}
                                    onCopy={handleCopy}
                                    isLoading={isLoading}
                                />
                                {result && (
                                    <>
                                        <StatusBar
                                            rowCount={result.rowCount ?? result.rows.length}
                                            executionTime={result.executionTime ?? 0}
                                            connectionName={result.connection}
                                        />
                                        <QueryPreview sql={result.query} />
                                    </>
                                )}
                                <div className="grid-wrapper">
                                    <ResultsGrid
                                        rows={result?.rows ?? []}
                                        columns={result?.columns ?? []}
                                        theme={theme}
                                        isLoading={isLoading}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                    <textarea
                                        className="form-input sql-editor"
                                        placeholder="Type SQL manually or ask Claude to query..."
                                        value={sql}
                                        onChange={(e) => setSql(e.target.value)}
                                    />
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleRunQuery}
                                        disabled={isLoading || !app}
                                        style={{ marginTop: 'var(--spacing-sm)' }}
                                    >
                                        Run Query
                                    </button>
                                </div>
                                <div style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)' }}>
                                    <EmptyState />
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
