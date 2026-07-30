import { env } from "cloudflare:workers";
import { parse } from "@popkorn/parser";
import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { examples } from "@/examples";
import { normalize, sha256, similarity } from "@/lib/scene-dedupe";

export const MAX_CSS_BYTES = 100_000;
const MAX_PER_IP_PER_HOUR = 5;
const REPORTS_TO_HIDE = 3;
/** Trigram-overlap ratio at or above which a submission counts as a rehash. */
const NEAR_DUPLICATE = 0.95;

export interface SceneRow {
  id: string;
  title: string;
  css: string;
  created_at: number;
}

export type SceneSummary = Omit<SceneRow, "css">;

// Hand-typed rather than generated: `wrangler types` emits workerd's global lib,
// which collides with the DOM lib the rest of the playground compiles against.
// This is the whole D1 surface we use.
interface D1 {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results: T[] }>;
      run(): Promise<unknown>;
    };
    first<T>(): Promise<T | null>;
    all<T>(): Promise<{ results: T[] }>;
  };
}

// Secrets are set with `wrangler secret put` and never appear in wrangler.json.
interface Bindings {
  DB: D1;
  TURNSTILE_SECRET?: string;
  IP_SALT?: string;
}

const bindings = () => env as unknown as Bindings;
const db = () => bindings().DB;

/** 16 URL-safe chars, 64 bits of entropy — unguessable enough, short enough. */
function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => b.toString(36).padStart(2, "0")).join("");
}

async function hashIp(): Promise<string> {
  const ip = getRequestIP({ xForwardedFor: true }) ?? "unknown";
  const salt = bindings().IP_SALT ?? "popkorn";
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${salt}:${ip}`),
  );
  return Array.from(new Uint8Array(digest).slice(0, 16), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

async function verifyTurnstile(token: string | undefined): Promise<boolean> {
  const secret = bindings().TURNSTILE_SECRET;
  // ponytail: no secret configured (local dev) => challenge is skipped, not failed.
  if (!secret) return true;
  if (!token) return false;
  const res = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: new URLSearchParams({ secret, response: token }),
    },
  );
  const body = (await res.json()) as { success?: boolean };
  return body.success === true;
}

export const submitScene = createServerFn({ method: "POST" })
  .validator((d: { title: string; css: string; token?: string }) => {
    const title = d.title.trim().slice(0, 80);
    if (!title) throw new Error("A title is required.");
    if (new TextEncoder().encode(d.css).length > MAX_CSS_BYTES)
      throw new Error("Scene is too large (100KB max).");
    return { title, css: d.css, token: d.token };
  })
  .handler(async ({ data }) => {
    if (!(await verifyTurnstile(data.token)))
      throw new Error("Challenge failed — please try again.");

    // Only playable scenes land: the parser is the gate.
    const fatal = parse(data.css).diagnostics.filter(
      (d) => d.severity === "error",
    );
    if (fatal.length)
      throw new Error(`Scene has parse errors: ${fatal[0].message}`);

    const ip = await hashIp();
    const since = Date.now() - 3_600_000;
    const { count } = (await db()
      .prepare(
        "SELECT COUNT(*) AS count FROM scenes WHERE ip_hash = ? AND created_at > ?",
      )
      .bind(ip, since)
      .first<{ count: number }>()) ?? { count: 0 };
    if (count >= MAX_PER_IP_PER_HOUR)
      throw new Error("Too many submissions — try again in an hour.");

    // Dedupe. Exact match is the UNIQUE index below; this catches the nudged
    // resubmission — a built-in example (or your own last upload) with a colour
    // tweaked. Only compared against the examples and this IP's recent scenes;
    // an all-pairs scan doesn't stay cheap and isn't what spam looks like.
    const normal = normalize(data.css);
    const { results: mine } = await db()
      .prepare(
        "SELECT css FROM scenes WHERE ip_hash = ? ORDER BY created_at DESC LIMIT 5",
      )
      .bind(ip)
      .all<{ css: string }>();
    for (const prior of [
      ...examples.map((e) => e.source),
      ...mine.map((r) => r.css),
    ]) {
      if (similarity(normal, normalize(prior)) >= NEAR_DUPLICATE)
        throw new Error(
          "That's too close to a scene that's already here — change it up before publishing.",
        );
    }

    const id = newId();
    try {
      await db()
        .prepare(
          "INSERT INTO scenes (id, title, css, ip_hash, created_at, content_hash) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id, data.title, data.css, ip, Date.now(), await sha256(normal))
        .run();
    } catch (e: unknown) {
      if (String(e).includes("UNIQUE"))
        throw new Error("That scene has already been published.");
      throw e;
    }
    return { id };
  });

export const getScene = createServerFn()
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    return await db()
      .prepare(
        "SELECT id, title, css, created_at FROM scenes WHERE id = ? AND hidden = 0",
      )
      .bind(id)
      .first<SceneRow>();
  });

export const listScenes = createServerFn()
  .validator((limit?: number) => Math.min(Math.max(limit ?? 60, 1), 60))
  .handler(async ({ data: limit }): Promise<SceneSummary[]> => {
    const { results } = await db()
      .prepare(
        "SELECT id, title, created_at FROM scenes WHERE hidden = 0 ORDER BY created_at DESC LIMIT ?",
      )
      .bind(limit)
      .all<SceneSummary>();
    return results;
  });

/** No moderation queue: N reports hides the scene, and that's the whole policy. */
export const reportScene = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    await db()
      .prepare(
        "UPDATE scenes SET reports = reports + 1, hidden = (reports + 1 >= ?) WHERE id = ?",
      )
      .bind(REPORTS_TO_HIDE, id)
      .run();
    return { ok: true };
  });
