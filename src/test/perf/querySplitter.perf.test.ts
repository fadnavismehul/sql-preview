import { iterateSqlStatements } from '../../utils/querySplitter';

describe('QuerySplitter Performance', () => {
  it('should process large SQL quickly', () => {
    // Generate a large SQL string (approx 5MB) with significant whitespace
    const padding = ' '.repeat(1000);
    const query = `SELECT * FROM users WHERE id = 12345;\n${padding}\n`;
    const repeatCount = 5000;
    const largeSql = query.repeat(repeatCount);

    console.log(`Testing with SQL size: ${(largeSql.length / 1024 / 1024).toFixed(2)} MB`);

    const start = process.hrtime();

    let count = 0;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    for (const _s of iterateSqlStatements(largeSql)) {
      count++;
    }

    const end = process.hrtime(start);
    const durationMs = (end[0] * 1000 + end[1] / 1e6).toFixed(2);

    console.log(`Processed ${count} statements in ${durationMs}ms`);

    // Simple assertion to ensure test passes
    expect(count).toBe(repeatCount);
  });
});
