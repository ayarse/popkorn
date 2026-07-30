import { createFileRoute } from "@tanstack/react-router";
import Docs from "@/pages/docs";
import { docsHead } from "@/routes/-docs-head";

export const Route = createFileRoute("/docs/$section")({
  head: ({ params }) => docsHead(params.section),
  component: Docs,
});
