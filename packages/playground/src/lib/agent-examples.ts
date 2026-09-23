import { loadExamples } from "@/examples";

export type AgentExample = { name: string; source: string };

let agentExamples: Promise<AgentExample[]> | undefined;

/** Gallery scenes for the read_example tool, keyed by their gallery label. */
export function loadAgentExamples(): Promise<AgentExample[]> {
  agentExamples ??= loadExamples().then((xs) =>
    xs.map((e) => ({ name: e.label, source: e.source })),
  );
  return agentExamples;
}
