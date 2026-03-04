import React from 'react';

interface StatusBarProps {
    rowCount: number;
    executionTime: number;
    connectionName?: string;
}

export const StatusBar: React.FC<StatusBarProps> = ({
    rowCount,
    executionTime,
    connectionName
}) => {
    return (
        <div className="status-bar">
            <span><strong>{rowCount}</strong> rows</span>
            <span>&bull;</span>
            <span><strong>{executionTime}ms</strong> execution</span>
            {connectionName && (
                <>
                    <span>&bull;</span>
                    <span>via <strong>{connectionName}</strong></span>
                </>
            )}
        </div>
    );
};
