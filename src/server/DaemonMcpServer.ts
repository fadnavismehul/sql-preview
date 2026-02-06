import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DaemonMcpToolManager } from './DaemonMcpToolManager';
import { SessionManager } from './SessionManager';
import { logger } from './ConsoleLogger';

export class DaemonMcpServer {
  private toolManager: DaemonMcpToolManager;

  constructor(
    private readonly server: Server,
    private readonly sessionManager: SessionManager,
    toolManager: DaemonMcpToolManager
  ) {
    this.toolManager = toolManager;
    this.setupHandlers();
  }

  private setupHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: this.toolManager.getTools(),
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async request => {
      return await this.toolManager.handleToolCall(request.params.name, request.params.arguments);
    });

    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const sessions = this.sessionManager.getAllSessions();
      // Flatten all tabs from all sessions
      const resources = sessions.flatMap(session =>
        Array.from(session.tabs.values()).map(tab => ({
          uri: `sql-preview://sessions/${session.id}/tabs/${tab.id}`,
          name: `${session.displayName} - ${tab.title}`,
          mimeType: 'application/json',
          description: `Query: ${tab.query}`,
        }))
      );

      return { resources };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async request => {
      const uri = request.params.uri;
      // Format: sql-preview://sessions/{sessionId}/tabs/{tabId}
      // Simple regex parse
      const match = uri.match(/sql-preview:\/\/sessions\/([^/]+)\/tabs\/([^/]+)/);
      if (!match || !match[1] || !match[2]) {
        throw new Error('Invalid resource URI');
      }

      const sessionId = match[1];
      const tabId = match[2];

      const session = this.sessionManager.getSession(sessionId);
      if (!session) {
        throw new Error('Session not found');
      }

      const tab = session.tabs.get(tabId);
      if (!tab) {
        throw new Error('Tab not found');
      }

      return {
        contents: [
          {
            uri: uri,
            mimeType: 'application/json',
            text: JSON.stringify(tab, null, 2),
          },
        ],
      };
    });
  }
}
