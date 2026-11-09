import type { AgentType } from "@/lib/types";

/**
 * Recorded runs replayed by the landing page's hero. Each beat happens at `at` ms after Run.
 * A beat with `wait: "approval"` pauses playback until the visitor decides.
 */
export type Beat =
  | { at: number; node: AgentType; kind: "start"; note?: string }
  | { at: number; node: AgentType; kind: "text"; text: string }
  | { at: number; node: AgentType; kind: "tool"; tool: string; arg: string; result: string }
  | { at: number; node: AgentType; kind: "done"; ms: number }
  | { at: number; node: "reviewer"; kind: "revise"; to: AgentType; feedback: string }
  | { at: number; node: "execution"; kind: "approval"; action: string; file: string; reason: string };

export interface Trace {
  id: string;
  label: string;
  task: string;
  beats: Beat[];
  result: { approved: string; rejected: string; sources: { n: number; file: string; page: number }[]; score: number };
}

export const TRACES: Trace[] = [
  {
    id: "risk",
    label: "Contract risk scan",
    task: "Find the riskiest clauses in our supplier contract and clean up superseded drafts.",
    beats: [
      { at: 0, node: "research", kind: "start" },
      { at: 500, node: "research", kind: "tool", tool: "kb_search", arg: "termination penalty", result: "5 passages" },
      { at: 1100, node: "research", kind: "tool", tool: "kb_search", arg: "liability cap indemnity", result: "4 passages" },
      { at: 1500, node: "research", kind: "text", text: "Termination for convenience costs 35% of remaining fees [1]. Liability is capped at 12 months of fees, but data breaches are uncapped [2]." },
      { at: 4300, node: "research", kind: "done", ms: 4300 },
      { at: 4400, node: "analyst", kind: "start" },
      { at: 4700, node: "analyst", kind: "text", text: "The uncapped breach liability is the largest exposure. The exit penalty matters only if we leave before year two." },
      { at: 7400, node: "analyst", kind: "done", ms: 3000 },
      { at: 7500, node: "reviewer", kind: "start" },
      { at: 7800, node: "reviewer", kind: "text", text: "Quantify the exit penalty in euros so the two risks can be compared." },
      { at: 9400, node: "reviewer", kind: "revise", to: "analyst", feedback: "Quantify the exit penalty." },
      { at: 9600, node: "analyst", kind: "start", note: "revision 1" },
      { at: 9900, node: "analyst", kind: "text", text: "Leaving after month 14 would cost about €182,000 [1]; a single breach has no ceiling [2]. Breach liability stays the priority." },
      { at: 12600, node: "analyst", kind: "done", ms: 3000 },
      { at: 12700, node: "execution", kind: "start" },
      { at: 13000, node: "execution", kind: "text", text: "Save the risk summary as a report. Remove the superseded 2024 draft so agents stop citing it." },
      { at: 14600, node: "execution", kind: "approval", action: "delete_document", file: "msa-draft-2024.pdf", reason: "Superseded by msa-2026.pdf; agents cited it twice." },
      { at: 15400, node: "execution", kind: "done", ms: 2700 },
      { at: 15500, node: "reviewer", kind: "start" },
      { at: 15800, node: "reviewer", kind: "text", text: "Both risks are quantified and cited. Approve." },
      { at: 17400, node: "reviewer", kind: "done", ms: 1900 },
    ],
    result: {
      approved: "Uncapped data-breach liability is the top risk [2]; exiting after month 14 costs about €182,000 [1]. Report saved, superseded draft removed.",
      rejected: "Uncapped data-breach liability is the top risk [2]; exiting after month 14 costs about €182,000 [1]. Report saved; the 2024 draft was kept as you asked.",
      sources: [
        { n: 1, file: "msa-2026.pdf", page: 14 },
        { n: 2, file: "msa-2026.pdf", page: 22 },
      ],
      score: 9,
    },
  },
  {
    id: "pricing",
    label: "Pricing brief",
    task: "Compare our two pricing tiers against what customers told us in interviews.",
    beats: [
      { at: 0, node: "research", kind: "start" },
      { at: 450, node: "research", kind: "tool", tool: "kb_search", arg: "pricing tiers seats", result: "6 passages" },
      { at: 1000, node: "research", kind: "tool", tool: "kb_search", arg: "interview price objection", result: "5 passages" },
      { at: 1400, node: "research", kind: "text", text: "Team costs €24 per seat; Business adds SSO and audit logs at €41 [1]. Seven of twelve interviewees named SSO as the reason to upgrade [3]." },
      { at: 4100, node: "research", kind: "done", ms: 4100 },
      { at: 4200, node: "analyst", kind: "start" },
      { at: 4500, node: "analyst", kind: "text", text: "SSO drives upgrades, yet it sits behind a 71% price step. A €32 middle tier with SSO would capture most of that demand." },
      { at: 7300, node: "analyst", kind: "done", ms: 3100 },
      { at: 7400, node: "reviewer", kind: "start" },
      { at: 7700, node: "reviewer", kind: "text", text: "Cite the interview count behind the middle-tier claim." },
      { at: 9100, node: "reviewer", kind: "revise", to: "analyst", feedback: "Cite the interview evidence." },
      { at: 9300, node: "analyst", kind: "start", note: "revision 1" },
      { at: 9600, node: "analyst", kind: "text", text: "7 of 12 interviewees upgrade for SSO alone [3]; 4 said €41 was too high [3]. A €32 tier with SSO addresses both." },
      { at: 12300, node: "analyst", kind: "done", ms: 3000 },
      { at: 12400, node: "execution", kind: "start" },
      { at: 12700, node: "execution", kind: "text", text: "Save the brief. Remove the outdated 2025 price sheet so nobody quotes it." },
      { at: 14200, node: "execution", kind: "approval", action: "delete_document", file: "price-sheet-2025.pdf", reason: "Prices changed in March; the sheet is out of date." },
      { at: 15000, node: "execution", kind: "done", ms: 2600 },
      { at: 15100, node: "reviewer", kind: "start" },
      { at: 15400, node: "reviewer", kind: "text", text: "The recommendation follows from the evidence. Approve." },
      { at: 16900, node: "reviewer", kind: "done", ms: 1800 },
    ],
    result: {
      approved: "Add a €32 tier with SSO: 7 of 12 interviewees upgrade for SSO alone [3] and €41 is a 71% jump from Team [1]. Brief saved, old price sheet removed.",
      rejected: "Add a €32 tier with SSO: 7 of 12 interviewees upgrade for SSO alone [3] and €41 is a 71% jump from Team [1]. Brief saved; the old price sheet stays.",
      sources: [
        { n: 1, file: "pricing-2026.pdf", page: 2 },
        { n: 3, file: "interviews-q3.md", page: 1 },
      ],
      score: 8,
    },
  },
  {
    id: "incident",
    label: "Incident review",
    task: "Summarise last week's outage from the postmortem and list the follow-ups still open.",
    beats: [
      { at: 0, node: "research", kind: "start" },
      { at: 450, node: "research", kind: "tool", tool: "kb_search", arg: "outage timeline root cause", result: "6 passages" },
      { at: 1000, node: "research", kind: "tool", tool: "kb_search", arg: "follow-up action owner", result: "4 passages" },
      { at: 1400, node: "research", kind: "text", text: "Checkout failed for 47 minutes after a certificate expired at 02:13 UTC [1]. Five follow-ups were filed; two have owners [2]." },
      { at: 4000, node: "research", kind: "done", ms: 4000 },
      { at: 4100, node: "analyst", kind: "start" },
      { at: 4400, node: "analyst", kind: "text", text: "The root cause is manual certificate renewal. The three unowned follow-ups all concern automating it." },
      { at: 7000, node: "analyst", kind: "done", ms: 2900 },
      { at: 7100, node: "reviewer", kind: "start" },
      { at: 7400, node: "reviewer", kind: "text", text: "Say which follow-up prevents a repeat, not only which are open." },
      { at: 8800, node: "reviewer", kind: "revise", to: "analyst", feedback: "Rank the follow-ups." },
      { at: 9000, node: "analyst", kind: "start", note: "revision 1" },
      { at: 9300, node: "analyst", kind: "text", text: "Automated renewal (unowned) prevents a repeat [2]; expiry alerts (owned) only shorten the next outage [2]." },
      { at: 11900, node: "analyst", kind: "done", ms: 2900 },
      { at: 12000, node: "execution", kind: "start" },
      { at: 12300, node: "execution", kind: "text", text: "Save the summary. Post it to the #incidents channel." },
      { at: 13700, node: "execution", kind: "approval", action: "send_webhook", file: "#incidents", reason: "The team asked for postmortem summaries in the channel." },
      { at: 14500, node: "execution", kind: "done", ms: 2500 },
      { at: 14600, node: "reviewer", kind: "start" },
      { at: 14900, node: "reviewer", kind: "text", text: "Clear priority, sourced timeline. Approve." },
      { at: 16300, node: "reviewer", kind: "done", ms: 1700 },
    ],
    result: {
      approved: "A manually renewed certificate took checkout down for 47 minutes [1]. Automating renewal is the follow-up that prevents a repeat, and it has no owner yet [2]. Posted to #incidents.",
      rejected: "A manually renewed certificate took checkout down for 47 minutes [1]. Automating renewal is the follow-up that prevents a repeat, and it has no owner yet [2]. Not posted.",
      sources: [
        { n: 1, file: "postmortem-1107.md", page: 1 },
        { n: 2, file: "postmortem-1107.md", page: 2 },
      ],
      score: 9,
    },
  },
];
