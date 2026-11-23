/**
 * MCP stdio transport for desktop AI clients. Tools are fetched from (and calls forwarded to)
 * the Vectura HTTP server so the AI edits the same live files as the editors.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { startServer, type ServerOptions } from './app';
import { MCP_INSTRUCTIONS } from './mcp';

export async function runStdioBridge(o: { url: string; token: string | null; start: ServerOptions }) {
  let base = o.url.replace(/\/$/, '');
  const headers = (): Record<string, string> => ({ 'Content-Type': 'application/json', ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) });

  const reachable = async () => {
    try {
      const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1500) });
      return r.ok && (await r.json()).app === 'vectura';
    } catch {
      return false;
    }
  };
  if (!(await reachable())) {
    try {
      const s = await startServer({ ...o.start, log: (m) => process.stderr.write(m + '\n') });
      base = s.url;
      process.stderr.write(`[vectura] started server at ${s.url} (open it in a browser to watch the AI design live)\n`);
    } catch (e) {
      process.stderr.write(`[vectura] could not reach or start a server at ${base}: ${(e as Error).message}\n`);
      throw e;
    }
  }

  const server = new Server({ name: 'vectura', version: '1.1.0' }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const r = await fetch(`${base}/api/tools`, { headers: headers() });
    const { tools } = (await r.json()) as { tools: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; readOnly: boolean }[] };
    return {
      tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema as { type: 'object' }, annotations: { readOnlyHint: t.readOnly } })),
    };
  });
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const r = await fetch(`${base}/api/tools/${encodeURIComponent(req.params.name)}`, { method: 'POST', headers: headers(), body: JSON.stringify(req.params.arguments ?? {}) });
    const data = (await r.json()) as { result?: unknown; error?: string };
    if (!r.ok || data.error) return { isError: true, content: [{ type: 'text', text: `Error: ${data.error ?? r.statusText}` }] };
    return { content: [{ type: 'text', text: JSON.stringify(data.result, null, 2) }] };
  });
  await server.connect(new StdioServerTransport());
  // the AI client owns our lifetime: exit when it closes stdin (also stops an auto-started server)
  process.stdin.on('close', () => process.exit(0));
}
