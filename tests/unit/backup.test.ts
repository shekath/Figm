import { afterAll, describe, expect, it } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Backup } from '../../server/backup';
import { startServer } from '../../server/app';
import { callTool } from '../../server/tools';

/** Minimal in-memory S3: PUT/GET objects and ListObjectsV2; checks a SigV4 header is present. */
const objects = new Map<string, Buffer>();
const s3 = http.createServer((req, res) => {
  if (!/^AWS4-HMAC-SHA256 Credential=AK\/\d{8}\/auto\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/.test(req.headers.authorization ?? '')) {
    res.writeHead(403).end('bad auth');
    return;
  }
  const url = new URL(req.url!, 'http://x');
  const key = decodeURIComponent(url.pathname.replace(/^\/bucket\/?/, ''));
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    if (req.method === 'PUT') {
      objects.set(key, Buffer.concat(chunks));
      res.writeHead(200).end();
    } else if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix));
      res.writeHead(200, { 'Content-Type': 'application/xml' }).end(`<ListBucketResult>${keys.map((k) => `<Contents><Key>${k}</Key></Contents>`).join('')}<IsTruncated>false</IsTruncated></ListBucketResult>`);
    } else if (req.method === 'GET' && objects.has(key)) res.writeHead(200).end(objects.get(key));
    else res.writeHead(404).end();
  });
});
const ready = new Promise<number>((r) => s3.listen(0, () => r((s3.address() as { port: number }).port)));
afterAll(() => s3.close());

describe('R2 / S3 backup', () => {
  it('uploads saved files and restores them into a fresh (ephemeral) data folder', async () => {
    const port = await ready;
    const cfg = { endpoint: `http://127.0.0.1:${port}`, bucket: 'bucket', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'auto', prefix: 'figmy/' };
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'figmy-b1-'));
    const b1 = new Backup(cfg, dir1);
    const srv = await startServer({ port: 0, dataDir: dir1, onFileSaved: (f) => b1.schedule(f), log: () => undefined });
    const { fileId } = (await callTool('create_file', { name: 'Backed up' }, { rooms: srv.rooms, publicUrl: '' })) as { fileId: string };
    await new Promise((r) => setTimeout(r, 1200)); // room save debounce
    await srv.close();
    await b1.flush();
    expect([...objects.keys()]).toContain(`figmy/rooms/${fileId}.json`);

    // "container restarted": empty disk, restore from the bucket
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'figmy-b2-'));
    const n = await new Backup(cfg, dir2).restore();
    expect(n).toBeGreaterThan(0);
    const srv2 = await startServer({ port: 0, dataDir: dir2, log: () => undefined });
    expect(srv2.rooms.list().map((r) => r.name)).toContain('Backed up');
    await srv2.close();
  });

  it('refuses path traversal in restored keys', async () => {
    const port = await ready;
    objects.set('figmy/../evil.txt', Buffer.from('x'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'figmy-b3-'));
    await new Backup({ endpoint: `http://127.0.0.1:${port}`, bucket: 'bucket', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'auto', prefix: 'figmy/' }, dir).restore();
    expect(fs.existsSync(path.join(dir, '..', 'evil.txt'))).toBe(false);
  });
});
