/**
 * Cloudflare Worker that runs the Figmy server in a Cloudflare Container.
 * Every request (HTTP + WebSocket) goes to ONE named container instance, so all editors share
 * the same rooms. The container's disk is ephemeral: files are backed up to R2 and restored on start.
 */
import { Container, getContainer } from '@cloudflare/containers';

interface Env {
  FIGMY: DurableObjectNamespace<FigmyContainer>;
  // plain vars (wrangler.jsonc "vars")
  PUBLIC_URL?: string;
  FIGMY_REQUIRE_LOGIN?: string;
  FIGMY_ALLOWED_DOMAINS?: string;
  FIGMY_ALLOWED_EMAILS?: string;
  FIGMY_GOOGLE_CLIENT_ID?: string;
  FIGMY_S3_ENDPOINT?: string;
  FIGMY_S3_BUCKET?: string;
  SLEEP_AFTER?: string;
  // secrets (wrangler secret put …)
  FIGMY_TOKEN?: string;
  FIGMY_S3_ACCESS_KEY_ID?: string;
  FIGMY_S3_SECRET_ACCESS_KEY?: string;
}

export class FigmyContainer extends Container<Env> {
  defaultPort = 4317;
  sleepAfter = '2h';

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    if (env.SLEEP_AFTER) this.sleepAfter = env.SLEEP_AFTER;
    const vars: Record<string, string | undefined> = {
      PUBLIC_URL: env.PUBLIC_URL,
      FIGMY_TOKEN: env.FIGMY_TOKEN,
      FIGMY_GOOGLE_CLIENT_ID: env.FIGMY_GOOGLE_CLIENT_ID,
      FIGMY_REQUIRE_LOGIN: env.FIGMY_REQUIRE_LOGIN,
      FIGMY_ALLOWED_DOMAINS: env.FIGMY_ALLOWED_DOMAINS,
      FIGMY_ALLOWED_EMAILS: env.FIGMY_ALLOWED_EMAILS,
      FIGMY_S3_ENDPOINT: env.FIGMY_S3_ENDPOINT,
      FIGMY_S3_BUCKET: env.FIGMY_S3_BUCKET,
      FIGMY_S3_ACCESS_KEY_ID: env.FIGMY_S3_ACCESS_KEY_ID,
      FIGMY_S3_SECRET_ACCESS_KEY: env.FIGMY_S3_SECRET_ACCESS_KEY,
    };
    this.envVars = Object.fromEntries(Object.entries(vars).filter(([, v]) => !!v)) as Record<string, string>;
  }

  override onStart() {
    console.log('Figmy container started');
  }
  override onError(error: unknown) {
    console.error('Figmy container error', error);
    throw error;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.FIGMY, 'main').fetch(request);
  },
};
