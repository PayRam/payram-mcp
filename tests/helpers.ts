import http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  Client,
  StreamableHTTPClientTransport,
  InMemoryTransport,
} from '@modelcontextprotocol/client';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { createPayramMcpServer } from '../src/mcp/createServer.js';

export type Era = 'modern' | 'legacy';

/** A connected client for the given protocol era, served in-process. */
export const connect = async (era: Era) => {
  if (era === 'modern') {
    const handler = createMcpHandler(() => createPayramMcpServer(), { legacy: 'reject' });
    const transport = new StreamableHTTPClientTransport(new URL('http://test.local/mcp'), {
      fetch: (url, init) => handler.fetch(new Request(url, init)),
    });
    const client = new Client(
      { name: 'payram-mcp-tests', version: '0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    await client.connect(transport);
    return {
      client,
      close: async () => {
        await client.close();
        await handler.close();
      },
    };
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createPayramMcpServer();
  const client = new Client({ name: 'payram-mcp-tests', version: '0' });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
};

export const textOf = (result: { content?: unknown }): string =>
  ((result.content as { type: string; text?: string }[]) ?? [])
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');

/** Run fn against a connected client, closing it afterwards. */
export const withClient = async <T>(era: Era, fn: (client: Client) => Promise<T>): Promise<T> => {
  const { client, close } = await connect(era);
  try {
    return await fn(client);
  } finally {
    await close();
  }
};

/** A throwaway HTTP server on a random loopback port. */
export const startMockServer = async (handler: http.RequestListener) => {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: () => {
      server.closeAllConnections();
      server.close();
    },
  };
};
