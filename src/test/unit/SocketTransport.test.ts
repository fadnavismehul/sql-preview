import { SocketTransport } from '../../server/SocketTransport';
import { Socket } from 'net';

describe('SocketTransport', () => {
  let mockSocket: Socket;
  let transport: SocketTransport;
  let onMessageSpy: jest.Mock;
  let onErrorSpy: jest.Mock;
  let onCloseSpy: jest.Mock;

  beforeEach(() => {
    mockSocket = new Socket();
    mockSocket.write = jest.fn((_chunk, cb) => {
      // Simulate successful write
      if (cb) {
        cb();
      }
      return true;
    }) as any;
    mockSocket.destroy = jest.fn();
    mockSocket.end = jest.fn();

    transport = new SocketTransport(mockSocket);
    onMessageSpy = jest.fn();
    onErrorSpy = jest.fn();
    onCloseSpy = jest.fn();

    transport.onmessage = onMessageSpy;
    transport.onerror = onErrorSpy;
    transport.onclose = onCloseSpy;
  });

  test('should parse valid JSON messages', () => {
    const message = { jsonrpc: '2.0', method: 'test', params: {} };
    const data = JSON.stringify(message) + '\n';

    // Simulate incoming data
    mockSocket.emit('data', Buffer.from(data));

    expect(onMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'test' }));
  });

  test('should handle multiple messages in one chunk', () => {
    const msg1 = JSON.stringify({ jsonrpc: '2.0', method: 'msg1' });
    const msg2 = JSON.stringify({ jsonrpc: '2.0', method: 'msg2' });
    const data = msg1 + '\n' + msg2 + '\n';

    mockSocket.emit('data', Buffer.from(data));

    expect(onMessageSpy).toHaveBeenCalledTimes(2);
    expect(onMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'msg1' }));
    expect(onMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'msg2' }));
  });

  test('should close connection if buffer exceeds limit', () => {
    const MAX_BUFFER_SIZE = 10 * 1024 * 1024;
    // Create a chunk slightly larger than limit with noise
    const hugeData = Buffer.alloc(MAX_BUFFER_SIZE + 100, 'a');

    mockSocket.emit('data', hugeData);

    expect(mockSocket.destroy).toHaveBeenCalled();
    expect(onErrorSpy).toHaveBeenCalledWith(expect.any(Error));
    expect(onErrorSpy.mock.calls[0][0].message).toContain('Message buffer exceeded');
  });

  test('should handle partial messages buffers', () => {
    const msg = JSON.stringify({ jsonrpc: '2.0', method: 'partial' });
    const part1 = msg.substring(0, 10);
    const part2 = msg.substring(10) + '\n';

    mockSocket.emit('data', Buffer.from(part1));
    expect(onMessageSpy).not.toHaveBeenCalled();

    mockSocket.emit('data', Buffer.from(part2));
    expect(onMessageSpy).toHaveBeenCalledWith(expect.objectContaining({ method: 'partial' }));
  });
});
