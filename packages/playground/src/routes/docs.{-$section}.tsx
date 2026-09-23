import { createFileRoute } from "@tanstack/react-router";
import { getDoc } from "@/lib/docs-content";
import Docs from "@/pages/docs";
import { docsHead } from "@/routes/-docs-head";

export const Route = createFileRoute("/docs/{-$section}")({
  loader: ({ params }) => getDoc({ data: params.section }),
  staleTime: Number.POSITIVE_INFINITY,
  head: ({ params }) => docsHead(params.section),
  component: Docs,
});
