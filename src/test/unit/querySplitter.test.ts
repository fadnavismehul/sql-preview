import { iterateSqlStatements } from '../../utils/querySplitter';

describe('iterateSqlStatements', () => {
    it('should split simple statements', () => {
        const sql = 'SELECT 1; SELECT 2;';
        const statements = [...iterateSqlStatements(sql)];

        expect(statements).toHaveLength(2);
        if (statements[0] && statements[1]) {
            expect(statements[0].statement).toBe('SELECT 1');
            expect(statements[1].statement).toBe('SELECT 2');
        }
    });

    it('should handle whitespace', () => {
        const sql = '  SELECT 1  ;  \nSELECT 2  ';
        const statements = [...iterateSqlStatements(sql)];

        expect(statements).toHaveLength(2);
        if (statements[0] && statements[1]) {
            expect(statements[0].statement).toBe('SELECT 1');
            expect(statements[1].statement).toBe('SELECT 2');
        }
    });

    it('should handle comments', () => {
        const sql = 'SELECT 1; -- comment \n SELECT 2;';
        const statements = [...iterateSqlStatements(sql)];

        expect(statements).toHaveLength(2);
        if (statements[0] && statements[1]) {
            expect(statements[0].statement).toBe('SELECT 1');
            expect(statements[1].statement).toBe('-- comment \n SELECT 2');
        }
    });

    it('should provide correct start and end indices', () => {
        const sql = 'SELECT 1; SELECT 2';
        const statements = [...iterateSqlStatements(sql)];

        expect(statements).toHaveLength(2);
        if (statements[0] && statements[1]) {
            expect(statements[0].start).toBe(0);
            expect(statements[0].end).toBe(8);
            expect(statements[0].executionStart).toBe(0);
            expect(statements[0].executionEnd).toBe(8);

            expect(statements[1].start).toBe(9);
            expect(statements[1].end).toBe(sql.length);
            expect(statements[1].executionStart).toBe(10);
            expect(statements[1].executionEnd).toBe(sql.length);
        }
    });

    it('should provide correct execution ranges with comments', () => {
        const sql = '  /* c */ SELECT 1  ;';
        const statements = [...iterateSqlStatements(sql)];

        expect(statements).toHaveLength(1);
        if (statements[0]) {
             expect(statements[0].statement).toBe('/* c */ SELECT 1');
             expect(statements[0].executionStart).toBe(2);
             expect(statements[0].executionEnd).toBe(18);
        }
    });
});
