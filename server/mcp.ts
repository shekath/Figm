import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { tools, type ToolContext } from './tools';

export const MCP_INSTRUCTIONS = `Figmy is a collaborative vector design tool. These tools read and edit design files live: every change appears instantly in the editors of everyone who has the file open.
Start with get_started (once), then list_files / get_file_outline to see the current design. Build screens with create_nodes using nested node specs (frames with auto layout and children). Use get_selection to act on what the user selected. Use add_interaction for prototypes and export_html to hand off code.`;

/** Build an MCP server exposing all Figmy design tools. */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'figmy', title: 'Figmy design', version: '1.1.0' }, { instructions: MCP_INSTRUCTIONS });
  for (const t of tools) {
    server.registerTool(
      t.name,
      {
        title: t.title,
        description: t.description,
        inputSchema: t.schema,
        annotations: { readOnlyHint: !!t.readOnly, destructiveHint: t.name === 'delete_nodes' || t.name === 'boolean_operation', openWorldHint: false },
      },
      async (args: Record<string, unknown>) => {
        try {
          const result = await t.run(args, ctx);
          return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
        } catch (e) {
          return { isError: true, content: [{ type: 'text' as const, text: `Error: ${(e as Error).message}` }] };
        }
      },
    );
  }
  return server;
}

/** Stateless Streamable HTTP endpoint: a fresh server/transport pair per request. */
export async function handleMcpHttp(req: IncomingMessage, res: ServerResponse, body: unknown, ctx: ToolContext) {
  if (req.method === 'GET' || req.method === 'DELETE') {
    // stateless server: no standalone SSE stream / sessions
    res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed.' }, id: null }));
    return;
  }
  const server = createMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
}
