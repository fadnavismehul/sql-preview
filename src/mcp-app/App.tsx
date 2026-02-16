import { useEffect, useState } from 'react';
import { useMcpApp } from './hooks/useMcpApp';
import { ResultsGrid } from './components/ResultsGrid';
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

    useEffect(() => {
        if (!app) return;

        app.ontoolresult = (toolResult) => {
            console.log('Received tool result:', toolResult);
            if (toolResult.data) {
                setResult(toolResult.data as QueryResult);
                setError(null);
            } else if (toolResult.isError) {
                // ext-apps might not have isError property directly on the payload, check docs
                // usually it's content being error or internal handling
            }
        };
    }, [app]);

    if (error) {
        return <div className="error-container">Error: {error}</div>;
    }

    if (!result) {
        return (
            <div className="empty-state">
                <p>Waiting for query results...</p>
            </div>
        );
    }

    return (
        <div className={`app-container ${theme === 'dark' ? 'dark-theme' : ''}`} style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <div className="toolbar" style={{ padding: '8px', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between' }}>
                <span>{result.rowCount} rows ({result.executionTime}ms)</span>
                {/* Future: Add Export/Re-run buttons here */}
            </div>
            <ResultsGrid rows={result.rows} columns={result.columns} theme={theme} />
        </div>
    );
}
