// Verifies the stdio MCP bridge (what Claude Desktop launches) talks to the running server.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
const url = process.env.FIGMY_URL || 'http://127.0.0.1:4318';
const transport = new StdioClientTransport({ command: 'node', args: ['server-dist/server.cjs', '--stdio'], env: { ...process.env, FIGMY_URL: url } });
const client = new Client({ name: 'stdio-test', version: '1.0.0' });
await client.connect(transport);
const { tools } = await client.listTools();
console.log('tools via stdio:', tools.length);
const r = await client.callTool({ name: 'list_files', arguments: {} });
const files = JSON.parse(r.content[0].text).files;
console.log('list_files ok:', Array.isArray(files), files.length, 'files');
const bad = await client.callTool({ name: 'get_nodes', arguments: { fileId: files[0].id, ids: ['nope'] } });
console.log('graceful missing node:', JSON.parse(bad.content[0].text).nodes[0].error === 'not found');
const err = await client.callTool({ name: 'create_nodes', arguments: { fileId: 'does-not-exist', nodes: [{ type: 'rect' }] } });
console.log('error surfaced as tool error:', err.isError === true);
await client.close();
if (tools.length < 20) process.exit(1);
