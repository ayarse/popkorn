import { env } from "cloudflare:workers";
import { auth, clerkClient } from "@clerk/tanstack-react-start/server";
import { parse } from "@popkorn/parser";
import { createServerFn } from "@tanstack/react-start";
import { getRequestIP } from "@tanstack/react-start/server";
import { examples } from "@/examples";
import { sceneAspect } from "@/lib/scene-aspect";
import { normalize, sha256, similarity } from "@/lib/scene-dedupe";

export const MAX_CSS_BYTES = 100_000;
const MAX_PER_USER_PER_HOUR = 10;
const REPORTS_TO_HIDE = 3;
/** Trigram-overlap ratio at or above which a submission counts as a rehash. */
const NEAR_DUPLICATE = 0.95;

export const MAX_TAGS = 5;

export interface SceneRow {
  id: string;
  title: string;
  css: string;
  created_at: number;
  /** Null on scenes published before submissions required an account. */
  author: string | null;
  /** Space-separated slugs as stored; use `parseTags` to read them. */
  tags: string;
}

/** `aspect` travels with the list so a card reserves its real height before
 *  the CSS is fetched — without it every thumbnail resizes on hydration. */
export type SceneSummary = Omit<SceneRow, "css" | "tags"> & {
  aspect: number;
  tags: string[];
};

/** Anything the user types becomes at most `MAX_TAGS` lowercase slugs — commas,
 *  spaces and `#` all read as separators, so no input format to explain. */
export function parseTags(raw: string): string[] {
  return [...new Set(raw.toLowerCase().match(/[a-z0-9-]+/g) ?? [])].slice(
    0,
    MAX_TAGS,
  );
}

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

/** Byline, snapshotted at publish time rather than joined on every listing —
 *  it costs one Clerk call per submission instead of one per page view.
 *  Username only: a public gallery shouldn't out anyone's legal name because
 *  they signed in with Google. No username set => no byline. */
async function displayName(userId: string): Promise<string | null> {
  try {
    return (await clerkClient().users.getUser(userId)).username || null;
  } catch {
    return null;
  }
}

export const submitScene = createServerFn({ method: "POST" })
  .validator((d: { title: string; css: string; tags?: string }) => {
    const title = d.title.trim().slice(0, 80);
    if (!title) throw new Error("A title is required.");
    if (new TextEncoder().encode(d.css).length > MAX_CSS_BYTES)
      throw new Error("Scene is too large (100KB max).");
    return { title, css: d.css, tags: parseTags(d.tags ?? "").join(" ") };
  })
  .handler(async ({ data }) => {
    const { userId } = await auth();
    if (!userId) throw new Error("Sign in to publish a scene.");

    // Only playable scenes land: the parser is the gate.
    const fatal = parse(data.css).diagnostics.filter(
      (d) => d.severity === "error",
    );
    if (fatal.length)
      throw new Error(`Scene has parse errors: ${fatal[0].message}`);

    const since = Date.now() - 3_600_000;
    const { count } = (await db()
      .prepare(
        "SELECT COUNT(*) AS count FROM scenes WHERE user_id = ? AND created_at > ?",
      )
      .bind(userId, since)
      .first<{ count: number }>()) ?? { count: 0 };
    if (count >= MAX_PER_USER_PER_HOUR)
      throw new Error("Too many submissions — try again in an hour.");

    // Dedupe. Exact match is the UNIQUE index below; this catches the nudged
    // resubmission — a built-in example (or your own last upload) with a colour
    // tweaked. Only compared against the examples and this user's recent scenes;
    // an all-pairs scan doesn't stay cheap and isn't what spam looks like.
    const normal = normalize(data.css);
    const { results: mine } = await db()
      .prepare(
        "SELECT css FROM scenes WHERE user_id = ? ORDER BY created_at DESC LIMIT 5",
      )
      .bind(userId)
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
          "INSERT INTO scenes (id, title, css, ip_hash, created_at, content_hash, user_id, author, tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(
          id,
          data.title,
          data.css,
          await hashIp(),
          Date.now(),
          await sha256(normal),
          userId,
          await displayName(userId),
          data.tags,
        )
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
    const row = await db()
      .prepare(
        "SELECT id, title, css, created_at, author, tags, user_id FROM scenes WHERE id = ? AND hidden = 0",
      )
      .bind(id)
      .first<SceneRow & { user_id: string | null }>();
    if (!row) return null;
    const { user_id, tags, ...scene } = row;
    // `mine` rides along so the editor knows to offer save/delete without a
    // second round trip. Authorisation still re-checks on write.
    const { userId } = await auth();
    return {
      ...scene,
      tags: tags ? tags.split(" ") : [],
      mine: Boolean(userId) && user_id === userId,
    };
  });

export const updateScene = createServerFn({ method: "POST" })
  .validator((d: { id: string; css: string; tags: string }) => {
    if (new TextEncoder().encode(d.css).length > MAX_CSS_BYTES)
      throw new Error("Scene is too large (100KB max).");
    return { ...d, tags: parseTags(d.tags).join(" ") };
  })
  .handler(async ({ data }) => {
    const { userId } = await auth();
    if (!userId) throw new Error("Sign in to edit a scene.");

    const fatal = parse(data.css).diagnostics.filter(
      (d) => d.severity === "error",
    );
    if (fatal.length)
      throw new Error(`Scene has parse errors: ${fatal[0].message}`);

    // No rate limit or dedupe here: editing your own scene doesn't grow the
    // gallery, and the near-duplicate check would flag every small revision.
    await db()
      .prepare(
        "UPDATE scenes SET css = ?, content_hash = ?, tags = ? WHERE id = ? AND user_id = ?",
      )
      .bind(
        data.css,
        await sha256(normalize(data.css)),
        data.tags,
        data.id,
        userId,
      )
      .run();
    return { ok: true };
  });

export const deleteScene = createServerFn({ method: "POST" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const { userId } = await auth();
    if (!userId) throw new Error("Sign in to delete a scene.");
    await db()
      .prepare("DELETE FROM scenes WHERE id = ? AND user_id = ?")
      .bind(id, userId)
      .run();
    return { ok: true };
  });

export const listScenes = createServerFn()
  .validator((limit?: number) => Math.min(Math.max(limit ?? 60, 1), 60))
  .handler(async ({ data: limit }): Promise<SceneSummary[]> => {
    const { results } = await db()
      .prepare(
        "SELECT id, title, created_at, author, tags, css FROM scenes WHERE hidden = 0 ORDER BY created_at DESC LIMIT ?",
      )
      .bind(limit)
      .all<SceneRow>();
    // NOTE: the page ships every scene and the community page filters in the
    // browser. Move search and the tag facet into SQL once the gallery outgrows
    // a single page of results.
    return results.map(({ css, tags, ...row }) => ({
      ...row,
      tags: tags ? tags.split(" ") : [],
      aspect: sceneAspect(css),
    }));
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
