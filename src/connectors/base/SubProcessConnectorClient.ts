import {
  IConnector,
  ConnectorConfig,
  QueryPage,
  ConnectionError,
  QueryError,
} from '@sql-preview/connector-api';
import { spawn } from 'child_process';
import * as readline from 'readline';

export class SubProcessConnectorClient implements IConnector {
  readonly supportsPagination = true;

  constructor(
    public readonly id: string,
    private readonly executablePath: string
  ) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  validateConfig(_config: ConnectorConfig): string | undefined {
    return undefined; // Let the subprocess validate it
  }

  async *runQuery(
    query: string,
    config: ConnectorConfig,
    authHeader?: string,
    cancelToken?: AbortSignal
  ): AsyncGenerator<QueryPage, void, unknown> {
    const args: string[] = ['--query', query];

    // We pass the config as a base64 encoded JSON string to avoid shell escaping issues
    const configStr = Buffer.from(JSON.stringify(config)).toString('base64');
    args.push('--config', configStr);

    if (authHeader) {
      args.push('--auth', Buffer.from(authHeader).toString('base64'));
    }

    const child = spawn(process.execPath, [this.executablePath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (cancelToken) {
      cancelToken.addEventListener('abort', () => {
        child.kill('SIGINT');
      });
    }

    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    let errorOutput = '';
    child.stderr.on('data', data => {
      errorOutput += data.toString();
    });

    try {
      for await (const line of rl) {
        if (!line.trim()) {
          continue;
        }
        try {
          const page = JSON.parse(line) as QueryPage;
          yield page;
        } catch (e) {
          // If it's not JSON, it might be raw text output (e.g. CLI mode just dumping results)
          // For now, assume the dual-mode CLI outputs strictly JSON QueryPages when queried by Daemon
          console.warn(`[SubProcess] Failed to parse stdout line as JSON: ${line}`);
        }
      }
    } finally {
      rl.close();
    }

    return new Promise((resolve, reject) => {
      child.on('close', code => {
        if (code !== 0 && code !== null) {
          reject(
            new QueryError(
              `Connector process exited with code ${code}. Error: ${errorOutput}`,
              query
            )
          );
        } else {
          resolve();
        }
      });
      child.on('error', err => {
        reject(new ConnectionError(`Failed to start connector process: ${err.message}`));
      });
    });
  }

  async testConnection(
    config: ConnectorConfig,
    authHeader?: string
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const iter = this.runQuery('SELECT 1', config, authHeader);
      await iter.next();
      return { success: true };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
