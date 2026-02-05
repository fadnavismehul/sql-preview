import * as assert from 'assert';
import { Logger } from '../../core/logging/Logger';

describe('Daemon Logging Integration', () => {
  it('should initialize the Output Channel', () => {
    const logger = Logger.getInstance();
    const channel = logger.getOutputChannel();
    assert.ok(channel, 'Output Channel should be initialized');
    assert.strictEqual(channel.name, 'SQL Preview', 'Output Channel name should be SQL Preview');
  });
});
