
import { useEffect, useState } from 'react';
import { useMcpApp } from './hooks/useMcpApp';
import { ResultsGrid } from './components/ResultsGrid';
import { ConnectionsManager } from './components/ConnectionsManager';
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
        if (!app) return;

        app.ontoolresult = (toolResult) => {
            console.log('Received tool result:', toolResult);
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
        if (!app) return;
        setIsLoading(true);
        setError(null);
        try {
            const result = await app.callServerTool({ name: 'run_query', arguments: { sql: sql, waitForResult: true } });
            console.log('Query Result:', result);
            if (result.data) {
                const data = result.data as QueryResult;
                // Auto-generate columns if missing but rows exist
                if ((!data.columns || data.columns.length === 0) && data.rows.length > 0) {
                    const firstRow = data.rows[0];
                    if (Array.isArray(firstRow)) {
                        // Generate columns for array data
                        data.columns = firstRow.map((_, index) => ({
                            name: `col${index}`,
                            type: 'text'
                        }));
                    } else {
                        // Generate columns for object data
                        data.columns = Object.keys(firstRow).map(key => ({
                            name: key,
                            type: typeof firstRow[key] === 'number' ? 'number' : 'text'
                        }));
                    }
                }

                // Normalization: Ensure rows are objects matching column names
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

                setResult(data);
            }
        } catch (e) {
            console.error('Query Error:', e);
            setError(String(e));
        } finally {
            setIsLoading(false);
        }
    };

    if (error) {
        return (
            <div className={`app-container ${theme === 'dark' ? 'dark-theme' : ''}`} style={{ padding: '20px' }}>
                <div className="error-container" style={{ color: 'red', marginBottom: '10px' }}>Error: {error}</div>
                <button onClick={() => setError(null)}>Back</button>
            </div>
        );
    }

    return (
        <div className={`app-container ${theme === 'dark' ? 'dark-theme' : ''}`} style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div className="nav-bar" style={{ padding: '10px', display: 'flex', gap: '10px', borderBottom: '1px solid var(--border-color)' }}>
                <button
                    onClick={() => setView('query')}
                    style={{ fontWeight: view === 'query' ? 'bold' : 'normal' }}
                >
                    Query
                </button>
                <button
                    onClick={() => setView('connections')}
                    style={{ fontWeight: view === 'connections' ? 'bold' : 'normal' }}
                >
                    Connections
                </button>
            </div>

            <div className="content" style={{ flex: 1, padding: '20px', overflow: 'auto' }}>
                {view === 'connections' ? (
                    <ConnectionsManager app={app} theme={theme} />
                ) : (
                    // Query View
                    result ? (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
                            <div className="toolbar" style={{ paddingBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span>{result.rowCount} rows ({result.executionTime}ms)</span>
                                <button onClick={() => setResult(null)} style={{ padding: '4px 8px' }}>New Query</button>
                            </div>
                            <ResultsGrid rows={result.rows} columns={result.columns} theme={theme} />
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <h2>SQL Preview</h2>
                            <textarea
                                value={sql}
                                onChange={(e) => setSql(e.target.value)}
                                rows={5}
                                style={{ width: '100%', fontFamily: 'monospace' }}
                            />
                            <button
                                onClick={handleRunQuery}
                                disabled={isLoading || !app}
                                style={{ padding: '8px 16px', alignSelf: 'flex-start', cursor: 'pointer' }}
                            >
                                {isLoading ? 'Running...' : 'Run Query'}
                            </button>
                        </div>
                    )
                )}
            </div>
        </div>
    );
}
