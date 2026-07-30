import { createFileRoute } from "@tanstack/react-router";
import { Playground } from "@/routes/-playground";

export const Route = createFileRoute("/")({ component: Playground });
