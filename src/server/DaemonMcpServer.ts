import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { DaemonMcpToolManager } from './DaemonMcpToolManager';
import { SessionManager } from './SessionManager';
import * as fs from 'fs';
import * as path from 'path';

const UI_RESOURCE_URI = 'ui://sql-preview/results-grid';

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
      // console.error('[DEBUG] Handling CallToolRequest:', request.params.name);
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

      // Add UI Resource
      resources.push({
        uri: UI_RESOURCE_URI,
        name: 'SQL Preview UI',
        mimeType: 'text/html;profile=mcp-app',
        description: 'Interactive Grid UI for SQL Preview',
      });

      return { resources };
    });

    this.server.setRequestHandler(ReadResourceRequestSchema, async request => {
      // console.error('[DEBUG] Handling ReadResourceRequest:', request.params.uri);

      const uri = request.params.uri;

      if (uri === UI_RESOURCE_URI) {
        try {
          // Determine path to bundled HTML
          // Daemon is running from out/server/Daemon.js
          const htmlPath = path.join(__dirname, '../../dist/mcp-app.html');

          if (!fs.existsSync(htmlPath)) {
            throw new Error(`UI bundle not found at ${htmlPath}. Please run 'npm run build'.`);
          }

          const html = fs.readFileSync(htmlPath, 'utf-8');
          return {
            contents: [
              {
                uri: UI_RESOURCE_URI,
                mimeType: 'text/html;profile=mcp-app',
                text: html,
              },
            ],
          };
        } catch (error) {
          throw new Error(`Failed to load UI resource: ${error}`);
        }
      }

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
