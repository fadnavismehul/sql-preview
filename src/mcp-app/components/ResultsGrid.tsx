import { useMemo } from 'react';
import { AgGridReact } from 'ag-grid-react';
import { ColDef } from 'ag-grid-community';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-alpine.css';

interface ResultsGridProps {
    rows: any[];
    columns: { name: string; type: string }[];
    theme: 'light' | 'dark';
}

export function ResultsGrid({ rows, columns, theme }: ResultsGridProps) {
    const columnDefs = useMemo<ColDef[]>(() => {
        return columns.map((col) => ({
            field: col.name,
            headerName: col.name,
            sortable: true,
            filter: true,
            resizable: true,
        }));
    }, [columns]);

    const defaultColDef = useMemo<ColDef>(() => ({
        sortable: true,
        filter: true,
        resizable: true,
        flex: 1,
        minWidth: 100,
    }), []);

    const gridTheme = theme === 'dark' ? 'ag-theme-alpine-dark' : 'ag-theme-alpine';

    return (
        <div className={`${gridTheme}`} style={{ flex: 1, width: '100%', height: '100%' }}>
            <AgGridReact
                rowData={rows}
                columnDefs={columnDefs}
                defaultColDef={defaultColDef}
                enableCellTextSelection={true}
                ensureDomOrder={true}
            />
        </div>
    );
}
