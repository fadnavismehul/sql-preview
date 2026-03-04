import React, { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, AllCommunityModule, themeAlpine } from 'ag-grid-community';

ModuleRegistry.registerModules([AllCommunityModule]);

interface ResultsGridProps {
    rows: Record<string, unknown>[];
    columns: { name: string; type: string }[];
    theme: 'light' | 'dark';
}

export function ResultsGrid({ rows, columns, theme }: ResultsGridProps) {
    const columnDefs = useMemo(() => {
        if (!columns) return [];
        return columns.map(col => ({
            field: col.name,
            headerName: col.name,
            sortable: true,
            filter: true,
            resizable: true,
        }));
    }, [columns]);

    const defaultColDef = useMemo(() => ({
        flex: 1,
        minWidth: 100,
    }), []);

    const myTheme = theme === 'dark'
        ? themeAlpine.withParams({
            backgroundColor: "var(--color-bg, #1e1e2e)",
            foregroundColor: "var(--color-text, #e2e8f0)",
            headerBackgroundColor: "var(--color-surface, #2a2a3e)",
            headerTextColor: "var(--color-text, #e2e8f0)",
            borderColor: "var(--color-border, #3d3d5c)",
        })
        : themeAlpine.withParams({
            backgroundColor: "var(--color-bg, #ffffff)",
            foregroundColor: "var(--color-text, #111827)",
            headerBackgroundColor: "var(--color-surface, #f3f4f6)",
            headerTextColor: "var(--color-text, #111827)",
            borderColor: "var(--color-border, #e5e7eb)",
        });

    if (!columns || columns.length === 0) {
        return <div className="empty-state">No data to display</div>;
    }

    return (
        <div style={{ flex: 1, overflow: 'hidden', width: '100%', height: '100%' }}>
            <AgGridReact
                rowData={rows}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                theme={myTheme}
            />
        </div>
    );
}
