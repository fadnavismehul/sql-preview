import React from 'react';

interface QueryPreviewProps {
    sql: string;
}

export const QueryPreview: React.FC<QueryPreviewProps> = ({ sql }) => {
    if (!sql) return null;

    return (
        <details className="sql-preview-details">
            <summary>View SQL Query</summary>
            <pre>
                <code>{sql}</code>
            </pre>
        </details>
    );
};
