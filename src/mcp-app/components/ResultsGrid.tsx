import { useMemo } from 'react';

interface ResultsGridProps {
    rows: any[];
    columns: { name: string; type: string }[];
    theme: 'light' | 'dark';
}

export function ResultsGrid({ rows, columns, theme }: ResultsGridProps) {
    // Simple HTML Table Fallback for guaranteed rendering
    const tableStyle = {
        width: '100%',
        borderCollapse: 'collapse' as const,
        fontSize: '13px',
        fontFamily: 'var(--vscode-editor-font-family, monospace)',
        color: theme === 'dark' ? '#ddd' : '#333',
    };

    const thStyle = {
        textAlign: 'left' as const,
        padding: '8px',
        borderBottom: `1px solid ${theme === 'dark' ? '#444' : '#ddd'}`,
        backgroundColor: theme === 'dark' ? '#252526' : '#f3f3f3',
        fontWeight: '600'
    };

    const tdStyle = {
        padding: '8px',
        borderBottom: `1px solid ${theme === 'dark' ? '#333' : '#eee'}`,
    };

    if (!columns || columns.length === 0) {
        return <div style={{ padding: 20 }}>No columns to display</div>;
    }

    return (
        <div style={{ flex: 1, overflow: 'auto', width: '100%', height: '100%' }}>
            <table style={tableStyle}>
                <thead>
                    <tr>
                        {columns.map((col, idx) => (
                            <th key={idx} style={thStyle}>{col.name}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, rIdx) => (
                        <tr key={rIdx} style={{ backgroundColor: theme === 'dark' ? (rIdx % 2 ? '#1e1e1e' : '#1a1a1a') : (rIdx % 2 ? '#fafafa' : '#fff') }}>
                            {columns.map((col, cIdx) => (
                                <td key={cIdx} style={tdStyle}>
                                    {row[col.name] !== undefined && row[col.name] !== null
                                        ? String(row[col.name])
                                        : <span style={{ color: '#888', fontStyle: 'italic' }}>null</span>}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
