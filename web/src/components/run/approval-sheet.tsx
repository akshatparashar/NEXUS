"use client";

import { useQueryClient } from "@tanstack/react-query";
import { clsx } from "clsx";
import { ShieldAlert } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, Field, Switch, Textarea } from "@/components/ui/primitives";
import { toast } from "@/components/ui/toast";
import { post } from "@/lib/api";
import type { Approval } from "@/lib/types";

const TOOL_TEXT: Record<string, (a: Record<string, unknown>) => string> = {
  delete_document: (a) => `Permanently delete “${a.filename}” and its chunks from the knowledge base.`,
  send_webhook: (a) => `POST a message to ${a.url}.`,
};

export function ApprovalSheet({ approval, open, onClose }: { approval: Approval; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [choices, setChoices] = useState<Record<number, boolean>>(() => Object.fromEntries(approval.actions.map((a) => [a.index, true])));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);

  const decide = async (approve: boolean) => {
    setBusy(approve ? "approve" : "reject");
    try {
      await post(`/approvals/${approval.id}/decision`, { approve, actions: approve ? choices : undefined, note });
      qc.invalidateQueries({ queryKey: ["run", approval.run_id] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
      toast.success(approve ? "Approved. The run continues." : "Rejected. The run continues without these actions.");
      onClose();
    } catch (e) {
      toast.error("Couldn't record the decision", (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const approvedCount = Object.values(choices).filter(Boolean).length;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={560}
      title="Approve these actions?"
      description="The Execution agent paused before doing something that cannot be undone. Nothing has happened yet."
    >
      <ul className="flex flex-col gap-2">
        {approval.actions.map((a) => (
          <li key={a.index} className={clsx("rounded-[10px] border p-3 transition-colors", choices[a.index] ? "border-[#5a4a24] bg-[var(--pill-warning-bg)]/40" : "border-white/[0.06]")}>
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-4 flex-none text-warning" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-medium">{(TOOL_TEXT[a.tool] ?? (() => a.tool))(a.args)}</p>
                {a.reason && <p className="mt-1 text-[13px] leading-5 text-muted">Why: {a.reason}</p>}
                <pre className="num mt-2 max-h-28 overflow-auto rounded-[6px] bg-black/30 px-2 py-1.5 text-[11px] leading-4 text-muted">{JSON.stringify(a.args, null, 2)}</pre>
              </div>
              <Switch checked={!!choices[a.index]} onChange={(v) => setChoices((c) => ({ ...c, [a.index]: v }))} label={`Allow ${a.tool}`} />
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-4">
        <Field label="Note for the log" htmlFor="approval-note">
          <Textarea id="approval-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" maxLength={1000} className="min-h-[60px]" />
        </Field>
      </div>
      <div className="mt-5 flex items-center justify-between gap-2">
        <Button variant="ghost" onClick={() => decide(false)} loading={busy === "reject"} disabled={!!busy}>
          Reject all
        </Button>
        <Button variant="primary" onClick={() => decide(true)} loading={busy === "approve"} disabled={!!busy || approvedCount === 0}>
          {approvedCount === approval.actions.length ? "Approve" : `Approve ${approvedCount} of ${approval.actions.length}`}
        </Button>
      </div>
    </Dialog>
  );
}
