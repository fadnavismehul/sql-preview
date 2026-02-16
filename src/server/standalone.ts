import { Daemon } from './Daemon';
import { logger } from './ConsoleLogger';

/**
 * Valid arguments:
 * --port <number>: Port to listen on (default: 8414)
 * --host <string>: Host to listen on (default: 127.0.0.1)
 */
function parseArgs() {
  const args = process.argv.slice(2);
  const config: Record<string, string> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg) {
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const value = args[i + 1];
      if (value && !value.startsWith('--')) {
        config[key] = value;
        i++;
      } else {
        config[key] = 'true';
      }
    }
  }
  return config;
}

async function main() {
  const args = parseArgs();

  // Set environment variables for Daemon to pick up
  if (args['port']) {
    process.env['MCP_PORT'] = args['port'];
  }

  if (args['loglevel']) {
    process.env['SQL_PREVIEW_LOG_LEVEL'] = args['loglevel'].toUpperCase();
  }

  logger.info('Starting SQL Preview MCP Server (Headless Mode)...');

  const daemon = new Daemon();

  // Handle signals
  process.on('SIGINT', () => {
    logger.info('Received SIGINT. Shutting down...');
    daemon.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    logger.info('Received SIGTERM. Shutting down...');
    daemon.stop();
    process.exit(0);
  });

  try {
    await daemon.start();
  } catch (error) {
    logger.error('Failed to start daemon:', error);
    process.exit(1);
  }
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error('Fatal error:', err);
  process.exit(1);
});
