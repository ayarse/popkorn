import { createServerFn } from "@tanstack/react-start";
import { findDoc } from "@/lib/docs";
import { type RenderedDoc, renderDoc } from "@/lib/docs-render";

const cache = new Map<string, RenderedDoc>();

/** One docs section, rendered on the server; the client never bundles marked or Prism's grammars. */
export const getDoc = createServerFn()
  .validator((section: string | undefined) => section)
  .handler(({ data }): RenderedDoc => {
    const { file } = findDoc(data);
    const doc = cache.get(file) ?? renderDoc(file);
    cache.set(file, doc);
    return doc;
  });
