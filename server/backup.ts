/**
 * Optional off-machine backup of the server's data folder to an S3-compatible bucket
 * (Cloudflare R2, AWS S3, MinIO…). Used when the server runs somewhere with an ephemeral disk,
 * such as Cloudflare Containers: data is restored on start and every saved file is uploaded.
 *
 * Env: FIGMY_S3_ENDPOINT (e.g. https://<account-id>.r2.cloudflarestorage.com), FIGMY_S3_BUCKET,
 *      FIGMY_S3_ACCESS_KEY_ID, FIGMY_S3_SECRET_ACCESS_KEY, optional FIGMY_S3_REGION (default "auto"),
 *      FIGMY_S3_PREFIX (default "figmy/").
 * Requests are signed with AWS Signature V4 using Node's crypto — no SDK dependency.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface BackupConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  prefix: string;
}

export function backupConfigFromEnv(env = process.env): BackupConfig | null {
  const { FIGMY_S3_ENDPOINT, FIGMY_S3_BUCKET, FIGMY_S3_ACCESS_KEY_ID, FIGMY_S3_SECRET_ACCESS_KEY } = env;
  if (!FIGMY_S3_ENDPOINT || !FIGMY_S3_BUCKET || !FIGMY_S3_ACCESS_KEY_ID || !FIGMY_S3_SECRET_ACCESS_KEY) return null;
  return {
    endpoint: FIGMY_S3_ENDPOINT.replace(/\/$/, ''),
    bucket: FIGMY_S3_BUCKET,
    accessKeyId: FIGMY_S3_ACCESS_KEY_ID,
    secretAccessKey: FIGMY_S3_SECRET_ACCESS_KEY,
    region: env.FIGMY_S3_REGION || 'auto',
    prefix: (env.FIGMY_S3_PREFIX ?? 'figmy/').replace(/^\//, ''),
  };
}

const sha256 = (data: string | Buffer) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: Buffer | string, data: string) => crypto.createHmac('sha256', key).update(data).digest();
const encodeKey = (k: string) => k.split('/').map(encodeURIComponent).join('/');

export class Backup {
  private queue = new Map<string, NodeJS.Timeout>();
  constructor(
    private cfg: BackupConfig,
    private dataDir: string,
    private log: (m: string) => void = () => undefined,
  ) {}

  /** Signed request to the bucket (path-style URLs, which R2 and S3 both accept). */
  async request(method: 'GET' | 'PUT' | 'DELETE', key: string, body?: Buffer, query: Record<string, string> = {}): Promise<Response> {
    const url = new URL(`${this.cfg.endpoint}/${this.cfg.bucket}/${encodeKey(key)}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const day = amzDate.slice(0, 8);
    const payloadHash = sha256(body ?? '');
    const headers: Record<string, string> = { host: url.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const signedHeaders = Object.keys(headers).sort().join(';');
    const canonicalQuery = [...url.searchParams.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    const canonical = [method, url.pathname, canonicalQuery, Object.keys(headers).sort().map((h) => `${h}:${headers[h]}\n`).join(''), signedHeaders, payloadHash].join('\n');
    const scope = `${day}/${this.cfg.region}/s3/aws4_request`;
    const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
    const kSigning = hmac(hmac(hmac(hmac(`AWS4${this.cfg.secretAccessKey}`, day), this.cfg.region), 's3'), 'aws4_request');
    const signature = crypto.createHmac('sha256', kSigning).update(toSign).digest('hex');
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    const { host: _host, ...sendHeaders } = headers;
    void _host;
    return fetch(url, { method, headers: { ...sendHeaders, Authorization: authorization }, body: body ? new Uint8Array(body) : undefined });
  }

  /** All object keys under the prefix (handles pagination). */
  async list(): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const q: Record<string, string> = { 'list-type': '2', prefix: this.cfg.prefix };
      if (token) q['continuation-token'] = token;
      const r = await this.request('GET', '', undefined, q);
      if (!r.ok) throw new Error(`backup list failed: ${r.status} ${(await r.text()).slice(0, 200)}`);
      const xml = await r.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1].replace(/&amp;/g, '&'));
      token = /<IsTruncated>true<\/IsTruncated>/.test(xml) ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1] : undefined;
    } while (token);
    return keys;
  }

  /** Download everything into the data folder (call before the server starts). */
  async restore(): Promise<number> {
    const keys = await this.list();
    let n = 0;
    for (const key of keys) {
      const rel = key.slice(this.cfg.prefix.length);
      if (!rel || rel.includes('..') || path.isAbsolute(rel)) continue;
      const r = await this.request('GET', key);
      if (!r.ok) {
        this.log(`[figmy] backup: could not restore ${rel} (${r.status})`);
        continue;
      }
      const dest = path.join(this.dataDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
      n++;
    }
    return n;
  }

  /** Upload a file from the data folder shortly after it changes (debounced per file). */
  schedule(absPath: string) {
    const rel = path.relative(this.dataDir, absPath).split(path.sep).join('/');
    if (rel.startsWith('..')) return;
    clearTimeout(this.queue.get(rel));
    this.queue.set(
      rel,
      setTimeout(() => {
        this.queue.delete(rel);
        this.upload(rel).catch((e) => this.log(`[figmy] backup upload of ${rel} failed: ${(e as Error).message}`));
      }, 1500),
    );
  }

  async upload(rel: string) {
    const file = path.join(this.dataDir, rel);
    if (!fs.existsSync(file)) return;
    const r = await this.request('PUT', this.cfg.prefix + rel, fs.readFileSync(file));
    if (!r.ok) throw new Error(`${r.status} ${(await r.text()).slice(0, 200)}`);
  }

  /** Upload anything still pending (on shutdown). */
  async flush() {
    const pending = [...this.queue.keys()];
    for (const t of this.queue.values()) clearTimeout(t);
    this.queue.clear();
    await Promise.all(pending.map((rel) => this.upload(rel).catch(() => undefined)));
  }
}
