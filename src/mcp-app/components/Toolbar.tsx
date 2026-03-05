import React from 'react';

interface ToolbarProps {
    onCopy: () => void;
}

export const Toolbar: React.FC<ToolbarProps> = ({
    onCopy
}) => {
    return (
        <div className="toolbar" style={{ borderBottom: 'none', paddingBottom: 0, marginBottom: 0 }}>
            <div className="toolbar-actions" style={{ paddingLeft: 'auto', marginLeft: 'auto' }}>
                <button
                    className="btn"
                    onClick={onCopy}
                    title="Copy full results to clipboard as TSV"
                >
                    Copy All
                </button>
            </div>
        </div>
    );
};
