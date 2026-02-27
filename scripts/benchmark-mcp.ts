import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { WebSocketClientTransport } from '@modelcontextprotocol/sdk/client/websocket.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import WebSocket from 'ws';

(global as any).WebSocket = WebSocket;

async function runBenchmark(transportType: 'ws' | 'sse', iterations = 100) {
  console.log(
    `\n--- Starting Benchmark: ${transportType.toUpperCase()} (${iterations} iterations) ---`
  );

  const sessionId = `bench-${transportType}-${Date.now()}`;
  let transport: any;

  if (transportType === 'ws') {
    const wsUrl = new URL(`ws://127.0.0.1:8414/mcp/ws?sessionId=${sessionId}`);
    transport = new WebSocketClientTransport(wsUrl);
  } else {
    const sseUrl = new URL(`http://127.0.0.1:8414/mcp?sessionId=${sessionId}`);
    transport = new SSEClientTransport(sseUrl);
  }

  const client = new Client({ name: 'benchmark-client', version: '1.0.0' }, { capabilities: {} });

  // Initial connection
  const connectStart = performance.now();
  await client.connect(transport);
  const connectEnd = performance.now();
  console.log(`Connection time: ${(connectEnd - connectStart).toFixed(2)}ms`);

  // Warmup
  await client.listTools();

  // RTT Test (Round Trip Time)
  const times: number[] = [];
  let bytesReceived = 0;
  let bytesSent = 0;

  const testStart = performance.now();

  for (let i = 0; i < iterations; i++) {
    const reqStart = performance.now();
    // listing tools returns a predictable JSON payload of about ~1KB
    const result = await client.listTools();
    const reqEnd = performance.now();

    // Approximate byte counting (JSON stringify length)
    bytesReceived += JSON.stringify(result).length;
    bytesSent += JSON.stringify({ method: 'tools/list' }).length;

    times.push(reqEnd - reqStart);
  }

  const testEnd = performance.now();
  const totalTime = testEnd - testStart;

  // Calculate stats
  const avgRtt = times.reduce((a, b) => a + b, 0) / iterations;
  const sortedTimes = [...times].sort((a, b) => a - b);
  const p95 = sortedTimes[Math.floor(iterations * 0.95)] || 0;
  const p99 = sortedTimes[Math.floor(iterations * 0.99)] || 0;
  const throughputMb = (bytesReceived + bytesSent) / 1024 / 1024 / (totalTime / 1000);

  console.log(`Completed ${iterations} requests in ${totalTime.toFixed(2)}ms`);
  console.log(`Average RTT: ${avgRtt.toFixed(2)}ms`);
  console.log(`p95 RTT:     ${p95.toFixed(2)}ms`);
  console.log(`p99 RTT:     ${p99.toFixed(2)}ms`);
  console.log(`Throughput:  ${throughputMb.toFixed(3)} MB/s`);

  await client.close();
}

async function main() {
  console.log('Ensure Daemon is running on 127.0.0.1:8414 before running this benchmark.');
  console.log('');

  try {
    // await runBenchmark('sse', 100);
    await runBenchmark('ws', 100);

    console.log('\n--- High Load Test ---');
    // await runBenchmark('sse', 1000);
    await runBenchmark('ws', 1000);

    console.log('\n✅ Benchmark suite completed successfully.');
  } catch (e) {
    console.error('❌ Benchmark failed:', e);
    process.exit(1);
  }
}

main().catch(console.error);
