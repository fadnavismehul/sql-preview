import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ModuleRegistry, themeQuartz } from 'ag-grid-community';
import { AllCommunityModule } from 'ag-grid-community';

// Register the Community module to avoid warnings or silent failures
ModuleRegistry.registerModules([AllCommunityModule]);

interface QueryResult {
    query: string;
    columns: Array<{ name: string; type: string }>;
    rows: Array<any[]>;
    rowCount: number;
    executionTime: number;
    connection: string;
}

export function McpResultsView({ theme, latestResult }: { theme: 'light' | 'dark', latestResult?: QueryResult | null }) {

    // Configure columns based on the latest result. Since rows are often arrays, we use valueGetter.
    const columnDefs = useMemo(() => {
        if (!latestResult?.columns) return [];
        return latestResult.columns.map((col, index) => ({
            headerName: col.name,
            valueGetter: (params: any) => {
                // Ensure we gracefully handle both array data rows and object rows
                if (Array.isArray(params.data)) {
                    return params.data[index];
                }
                if (params.data && typeof params.data === 'object' && col.name in params.data) {
                    return params.data[col.name];
                }
                return undefined;
            },
            sortable: true,
            filter: true,
            resizable: true,
        }));
    }, [latestResult]);

    const defaultColDef = useMemo(() => ({
        flex: 1,
        minWidth: 100,
        filter: true,
    }), []);

    // Theming with modern Quartz theme based on CSS Custom Properties
    const gridTheme = useMemo(() => {
        if (theme === 'dark') {
            return themeQuartz.withParams({
                backgroundColor: 'var(--color-bg, #1e1e2e)',
                foregroundColor: 'var(--color-text, #e2e8f0)',
                headerBackgroundColor: 'var(--color-surface, #2a2a3e)',
                headerTextColor: 'var(--color-text, #e2e8f0)',
                borderColor: 'var(--color-border, #3d3d5c)',
                rowBorder: 'solid 1px var(--color-border, #3d3d5c)',
                browserColorScheme: 'dark',
                spacing: 8,
                fontSize: 13,
                headerFontSize: 13,
                headerFontWeight: 600,
            }, 'dark-mcp');
        } else {
            return themeQuartz.withParams({
                backgroundColor: 'var(--color-bg, #ffffff)',
                foregroundColor: 'var(--color-text, #111827)',
                headerBackgroundColor: 'var(--color-surface, #f3f4f6)',
                headerTextColor: 'var(--color-text, #111827)',
                borderColor: 'var(--color-border, #e5e7eb)',
                rowBorder: 'solid 1px var(--color-border, #e5e7eb)',
                browserColorScheme: 'light',
                spacing: 8,
                fontSize: 13,
                headerFontSize: 13,
                headerFontWeight: 600,
            }, 'light-mcp');
        }
    }, [theme]);

    if (!latestResult || latestResult.rows.length === 0) {
        return <div className="empty-state">No data to display</div>;
    }

    return (
        <div style={{ flex: 1, overflow: 'hidden', width: '100%', height: '100%' }}>
            <AgGridReact
                rowData={latestResult.rows}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                theme={gridTheme}
            />
        </div>
    );
}
