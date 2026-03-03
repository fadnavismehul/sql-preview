/**
 * Integration tests for MySQLConnector using testcontainers.
 *
 * Requires Docker (Colima or Docker Desktop) to be running.
 * Run with: npm run test:integration
 *
 * These tests spin up a real mysql:8.0 container, run actual queries,
 * and validate the full round-trip including schema metadata.
 */

import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';
import MySQLConnector, { MySQLConfig } from '../index';

// ────────────────────────────────────────────────────────────────────────────
// Container lifecycle — shared across all tests in this file
// ────────────────────────────────────────────────────────────────────────────
let container: StartedMySqlContainer;
let config: MySQLConfig;
let connector: MySQLConnector;

beforeAll(async () => {
    // Pull and start MySQL 8.0 (may take 30-60s on first run)
    container = await new MySqlContainer('mysql:8.0')
        .withRootPassword('testroot')
        .withDatabase('testdb')
        .withUsername('testuser')
        .withUserPassword('testpass')
        .start();

    config = {
        host: container.getHost(),
        port: container.getPort(),
        user: 'testuser',
        password: 'testpass',
        database: 'testdb',
    };

    connector = new MySQLConnector();

    // Create test schema using explicit mysql2 options (no boolean ssl — avoids type mismatch)
    const { createConnection } = await import('mysql2/promise');
    const conn = await createConnection({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password ?? '',
        database: config.database,
        multipleStatements: true,
    });

    await conn.execute(`CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(200),
    score FLOAT,
    active BIT(1) DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
    await conn.execute(`INSERT INTO users (name, email, score, active) VALUES
    ('Alice', 'alice@example.com', 9.5, 1),
    ('Bob', 'bob@example.com', 7.2, 0),
    ('Carol', NULL, 8.1, 1)
  `);
    try {
        await conn.execute(`CREATE VIEW active_users AS
      SELECT id, name, score FROM users WHERE active = 1
    `);
    } catch {
        // View may already exist if container is reused
    }
    await conn.end();
}, 120_000); // Allow 2 minutes for container + setup

afterAll(async () => {
    if (container) await container.stop();
});

// Helper
async function collect(gen: AsyncGenerator<any>): Promise<any[]> {
    const pages: any[] = [];
    for await (const page of gen) pages.push(page);
    return pages;
}

// ────────────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────────────

describe('MySQLConnector — integration', () => {
    describe('testConnection', () => {
        it('returns success:true for valid credentials', async () => {
            const result = await connector.testConnection(config);
            expect(result.success).toBe(true);
        });

        it('returns success:false for wrong password', async () => {
            const result = await connector.testConnection({ ...config, password: 'wrongpassword' });
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('returns success:false for unreachable host', async () => {
            const result = await connector.testConnection({ ...config, host: '192.0.2.1', connectTimeout: 2000 });
            expect(result.success).toBe(false);
        });
    });

    describe('runQuery', () => {
        it('SELECT 1+1 yields correct result', async () => {
            const pages = await collect(connector.runQuery('SELECT 1 + 1 AS result', config));

            expect(pages).toHaveLength(1);
            const [page] = pages;
            expect(page.columns).toHaveLength(1);
            expect(page.columns[0].name).toBe('result');
            expect(page.columns[0].type).toBe('integer');
            expect(page.data[0][0]).toBe(2);
        });

        it('returns correct rows from users table', async () => {
            const pages = await collect(connector.runQuery('SELECT id, name FROM users ORDER BY id', config));

            expect(pages).toHaveLength(1);
            const { columns, data } = pages[0];
            expect(columns[0]).toMatchObject({ name: 'id', type: 'integer' });
            expect(columns[1]).toMatchObject({ name: 'name', type: 'string' });
            expect(data).toHaveLength(3);
            expect(data[0][1]).toBe('Alice');
            expect(data[1][1]).toBe('Bob');
        });

        it('handles NULL values correctly', async () => {
            const pages = await collect(
                connector.runQuery("SELECT email FROM users WHERE name = 'Carol'", config),
            );
            expect(pages[0].data[0][0]).toBeNull();
        });


        it('maps FLOAT type correctly', async () => {
            const pages = await collect(
                connector.runQuery('SELECT score FROM users WHERE score IS NOT NULL LIMIT 1', config),
            );
            expect(pages[0].columns[0].type).toBe('number');
            expect(typeof pages[0].data[0][0]).toBe('number');
        });

        it('maps DATETIME type correctly', async () => {
            const pages = await collect(
                connector.runQuery('SELECT created_at FROM users LIMIT 1', config),
            );
            expect(pages[0].columns[0].type).toBe('timestamp');
        });

        it('returns empty data array for zero-row query', async () => {
            const pages = await collect(
                connector.runQuery("SELECT * FROM users WHERE name = 'Nobody'", config),
            );
            expect(pages).toHaveLength(1);
            expect(pages[0].data).toHaveLength(0);
        });

        it('stats.rowCount matches actual rows returned', async () => {
            const pages = await collect(connector.runQuery('SELECT * FROM users', config));
            expect(pages[0].stats.rowCount).toBe(3);
        });
    });

    describe('listSchemas', () => {
        it('returns testdb schema', async () => {
            const schemas = await connector.listSchemas(config);
            const names = schemas.map(s => s.schema);
            expect(names).toContain('testdb');
        });

        it('excludes system schemas', async () => {
            const schemas = await connector.listSchemas(config);
            const names = schemas.map(s => s.schema);
            expect(names).not.toContain('information_schema');
            expect(names).not.toContain('performance_schema');
            expect(names).not.toContain('mysql');
            expect(names).not.toContain('sys');
        });
    });

    describe('listTables', () => {
        it('returns tables in testdb', async () => {
            const tables = await connector.listTables(config, 'testdb');
            const names = tables.map(t => t.name);
            expect(names).toContain('users');
        });

        it('returns view with VIEW type label', async () => {
            const tables = await connector.listTables(config, 'testdb');
            const view = tables.find(t => t.name === 'active_users');
            expect(view).toBeDefined();
            expect(view!.type).toBe('VIEW');
        });

        it('returns TABLE type for base tables', async () => {
            const tables = await connector.listTables(config, 'testdb');
            const table = tables.find(t => t.name === 'users');
            expect(table!.type).toBe('TABLE');
        });
    });

    describe('describeTable', () => {
        it('returns correct column info for users table', async () => {
            const result = await connector.describeTable(config, 'users', 'testdb');

            expect(result.table).toMatchObject({ name: 'users', schema: 'testdb' });
            expect(result.columns.length).toBeGreaterThanOrEqual(5);

            const idCol = result.columns.find(c => c.name === 'id');
            expect(idCol).toBeDefined();
            expect(idCol!.isPrimaryKey).toBe(true);
            expect(idCol!.nullable).toBe(false);

            const emailCol = result.columns.find(c => c.name === 'email');
            expect(emailCol!.nullable).toBe(true);
            expect(emailCol!.isPrimaryKey).toBe(false);

            const nameCol = result.columns.find(c => c.name === 'name');
            expect(nameCol!.nullable).toBe(false);
        });

        it('returns columns in ordinal position order', async () => {
            const result = await connector.describeTable(config, 'users', 'testdb');
            const positions = result.columns.map(c => c.ordinalPosition);
            expect(positions).toEqual([...positions].sort((a, b) => a - b));
        });
    });
});
