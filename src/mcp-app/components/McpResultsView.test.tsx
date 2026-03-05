/**
 * @jest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { McpResultsView } from './McpResultsView';

describe('McpResultsView', () => {
    it('renders empty state when no results provided', () => {
        render(<McpResultsView theme="light" latestResult={null} />);
        expect(screen.getByText('No data to display')).toBeTruthy();
    });

    it('renders empty state when rows are empty', () => {
        const emptyResult = {
            query: 'SELECT 1',
            columns: [{ name: 'col1', type: 'number' }],
            rows: [],
            rowCount: 0,
            executionTime: 0,
            connection: 'test'
        };
        render(<McpResultsView theme="dark" latestResult={emptyResult} />);
        expect(screen.getByText('No data to display')).toBeTruthy();
    });

    it('renders ag-grid successfully with valid data', async () => {
        const dummyResult = {
            query: 'SELECT * FROM users',
            columns: [
                { name: 'id', type: 'number' },
                { name: 'username', type: 'string' }
            ],
            // Array of Arrays pattern expected by the App normalization
            rows: [
                [1, 'admin'],
                [2, 'user1']
            ],
            rowCount: 2,
            executionTime: 10,
            connection: 'test'
        };

        const { container } = render(<McpResultsView theme="light" latestResult={dummyResult} />);

        // ag-grid-react renders a div with ag-root class or ag-header
        expect(container.querySelector('.ag-root')).toBeTruthy();

        // Check that column headers are rendered
        expect(await screen.findByText('id')).toBeTruthy();
        expect(await screen.findByText('username')).toBeTruthy();

        // Check that data values are rendered 
        expect(await screen.findByText('admin')).toBeTruthy();
        expect(await screen.findByText('user1')).toBeTruthy();
    });

    it('handles generic object data gracefully', async () => {
        const objResult = {
            query: 'SELECT * FROM dummy',
            columns: [
                { name: 'score', type: 'number' }
            ],
            // Non-array objects pattern
            rows: [
                { score: 99 },
                { score: 100 }
            ],
            rowCount: 2,
            executionTime: 5,
            connection: 'test'
        } as any;

        render(<McpResultsView theme="dark" latestResult={objResult} />);

        // Confirm fallback object property parsing via valueGetter works
        expect(await screen.findByText('score')).toBeTruthy();
        expect(await screen.findByText('99')).toBeTruthy();
        expect(await screen.findByText('100')).toBeTruthy();
    });
});
