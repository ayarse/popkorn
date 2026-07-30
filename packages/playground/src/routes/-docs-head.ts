import { docDescription, findDoc } from "@/lib/docs";
import { SITE } from "@/routes/__root";

/** Per-section title/description/canonical for the two docs routes. */
export function docsHead(section: string | undefined) {
  const doc = findDoc(section);
  const title = `${doc.label} — Popkorn docs`;
  const description = docDescription(doc.file);
  const url = `${SITE}/docs/${doc.key}`;
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}
