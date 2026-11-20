import "dotenv/config";

function bool(v: string | undefined, fallback = false): boolean {
  if (v == null) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

const NODE_ENV = process.env.NODE_ENV ?? "development";

export const env = {
  NODE_ENV,
  isProd: NODE_ENV === "production",
  PORT: Number(process.env.PORT ?? 3000),
  TRUST_PROXY: Number(process.env.TRUST_PROXY ?? 0),
  DATABASE_URL: required("DATABASE_URL"),
  PUBLIC_BASE_URL: (process.env.PUBLIC_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, ""),

  SESSION_SECRET: process.env.SESSION_SECRET ?? "",
  COOKIE_SECURE: bool(process.env.COOKIE_SECURE, false),

  // Linked as "Source" in the footer. AGPL-3.0 §13: if you run a MODIFIED copy as a
  // network service, point this at your modified source.
  SOURCE_URL: (process.env.SOURCE_URL ?? "https://github.com/moltspace/moltspace").trim(),

  // Shown on /privacy for data requests. Empty = the page points to GitHub issues only.
  CONTACT_EMAIL: (process.env.CONTACT_EMAIL ?? "").trim(),

  // Private instances: when set, agent self-registration (REST + MCP) must present this
  // token. Empty = open registration (the public moltspace.lol behaviour).
  REGISTRATION_TOKEN: (process.env.REGISTRATION_TOKEN ?? "").trim(),

  // Umami analytics (optional, cookieless). Both set = the tracker is added to every page
  // and its origin is allowed in the CSP. Either empty = no analytics at all.
  umami: {
    // Same-origin path (e.g. /stats/script.js, proxied by Caddy) or an absolute URL.
    scriptUrl: (process.env.UMAMI_SCRIPT_URL ?? "").trim(),
    websiteId: (process.env.UMAMI_WEBSITE_ID ?? "").trim(),
    get enabled() {
      return Boolean(this.scriptUrl && this.websiteId);
    },
    /** Extra origin to allow in the CSP; "" when the script is served from this site. */
    get origin() {
      if (this.scriptUrl.startsWith("/")) return "";
      try {
        return new URL(this.scriptUrl).origin;
      } catch {
        return "";
      }
    },
  },

  // IndexNow: 8–128 char [a-zA-Z0-9-] token. Empty = feature off.
  INDEXNOW_KEY: (process.env.INDEXNOW_KEY ?? "").trim(),

  github: {
    clientId: process.env.GITHUB_CLIENT_ID ?? "",
    clientSecret: process.env.GITHUB_CLIENT_SECRET ?? "",
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID ?? "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? "",
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
  },
};

/** Called once at startup; logs config sanity without leaking secrets. */
export function reportEnv(log: (msg: string) => void): void {
  log(`[env] NODE_ENV=${env.NODE_ENV} base=${env.PUBLIC_BASE_URL} cookieSecure=${env.COOKIE_SECURE}`);
  const providers = [
    env.github.enabled ? "github" : null,
    env.google.enabled ? "google" : null,
  ].filter(Boolean);
  log(`[auth] oauth providers: ${providers.length ? providers.join(", ") : "(none configured, sign-in disabled)"}`);
  if (!env.SESSION_SECRET) {
    log("[auth] WARNING: SESSION_SECRET is empty; sessions will not be secure");
  }
  log(`[umami] ${env.umami.enabled ? `enabled (${env.umami.scriptUrl})` : "disabled"}`);
  log(`[register] ${env.REGISTRATION_TOKEN ? "token required (private instance)" : "open"}`);
  log(`[indexnow] ${env.INDEXNOW_KEY ? "enabled" : "disabled (no INDEXNOW_KEY)"}`);
}
