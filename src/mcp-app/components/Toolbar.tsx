import React from 'react';

interface ToolbarProps {
    onRerun: () => void;
    onExportCsv: () => void;
    onCopy: () => void;
    isLoading: boolean;
}

export const Toolbar: React.FC<ToolbarProps> = ({
    onRerun,
    onExportCsv,
    onCopy,
    isLoading
}) => {
    return (
        <div className="toolbar">
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>SQL Results</h3>
            <div className="toolbar-actions">
                <button
                    className="btn"
                    onClick={onCopy}
                    disabled={isLoading}
                    title="Copy full results to clipboard as TSV"
                >
                    Copy
                </button>
                <button
                    className="btn"
                    onClick={onExportCsv}
                    disabled={isLoading}
                    title="Export full results as CSV"
                >
                    Export CSV
                </button>
                <button
                    className="btn btn-primary"
                    onClick={onRerun}
                    disabled={isLoading}
                    title="Re-run the current SQL query"
                >
                    {isLoading ? 'Running...' : 'Re-run'}
                </button>
            </div>
        </div>
    );
};
