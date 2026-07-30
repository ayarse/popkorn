import { createFileRoute } from "@tanstack/react-router";
import Docs from "@/pages/docs";
import { docsHead } from "@/routes/-docs-head";

export const Route = createFileRoute("/docs/")({
  head: () => docsHead("introduction"),
  component: Docs,
});
