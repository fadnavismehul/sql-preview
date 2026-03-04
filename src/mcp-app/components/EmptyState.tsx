import React from 'react';

export const EmptyState: React.FC = () => {
    return (
        <div className="empty-state">
            <div style={{ fontSize: '48px', marginBottom: 'var(--spacing-md)', color: 'var(--color-primary)' }}>
                🔍
            </div>
            <h3>SQL Preview is ready</h3>
            <p>Ask Claude to query your database seamlessly.</p>
            <div style={{ marginTop: 'var(--spacing-lg)', background: 'var(--color-bg)', padding: 'var(--spacing-md)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', color: 'var(--color-text)', textAlign: 'left', maxWidth: '400px' }}>
                <strong style={{ fontSize: '12px', textTransform: 'uppercase', color: 'var(--color-text-muted)', letterSpacing: '0.5px' }}>Example Prompts</strong>
                <ul style={{ margin: '10px 0 0 0', paddingLeft: '20px', fontSize: '14px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <li>"Show me the top 10 customers by revenue."</li>
                    <li>"List all tables in the public schema."</li>
                    <li>"What is the total sales amount per region this month?"</li>
                </ul>
            </div>
        </div>
    );
};
