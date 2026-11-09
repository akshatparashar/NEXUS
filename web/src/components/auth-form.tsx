"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Mark } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { ApiError, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { Session } from "@/lib/types";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const setSession = useSession((s) => s.setSession);
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const isRegister = mode === "register";
  const task = params.get("task");
  const next = params.get("next") || (task ? `/app/workflows?task=${encodeURIComponent(task)}` : "/app");

  const validate = () => {
    const fe: Record<string, string> = {};
    if (isRegister && !form.name.trim()) fe.name = "Tell us what to call you.";
    if (!/^\S+@\S+\.\S+$/.test(form.email)) fe.email = "Enter an email address like ada@example.com.";
    if (isRegister && form.password.length < 8) fe.password = "Use at least 8 characters.";
    if (!isRegister && !form.password) fe.password = "Enter your password.";
    setFieldErrors(fe);
    return Object.keys(fe).length === 0;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const s = await post<Session>(isRegister ? "/auth/register" : "/auth/login", isRegister ? form : { email: form.email, password: form.password });
      setSession(s);
      router.replace(next.startsWith("/") ? next : "/app");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong. Try again.");
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Link href="/" className="flex w-fit items-center gap-2.5" aria-label="NEXUS home">
          <Mark />
          <span className="text-[15px] font-semibold tracking-[-0.01em]">NEXUS</span>
        </Link>
        <div className="mx-auto flex w-full max-w-[380px] flex-1 flex-col justify-center py-12">
          <h1 className="text-[28px] font-semibold leading-9 tracking-[-0.02em]">{isRegister ? "Create your workspace" : "Sign in to NEXUS"}</h1>
          <p className="mt-2 text-[14px] leading-[22px] text-muted">
            {isRegister
              ? "Your workspace starts with three template workflows. Upload a document and run one in under a minute."
              : "Pick up where your agents left off."}
          </p>
          <form onSubmit={submit} noValidate className="mt-8 flex flex-col gap-4">
            {isRegister && (
              <Field label="Name" htmlFor="name" error={fieldErrors.name}>
                <Input id="name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ada Lovelace" autoFocus />
              </Field>
            )}
            <Field label="Email" htmlFor="email" error={fieldErrors.email}>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="ada@example.com"
                autoFocus={!isRegister}
              />
            </Field>
            <Field label="Password" htmlFor="password" error={fieldErrors.password} hint={isRegister ? "At least 8 characters." : undefined}>
              <Input
                id="password"
                type="password"
                autoComplete={isRegister ? "new-password" : "current-password"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            </Field>
            {error && (
              <p role="alert" className="rounded-[6px] bg-[var(--pill-negative-bg)] px-3 py-2 text-[13px] text-[var(--pill-negative-ink)]">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" loading={busy} className="mt-2 h-10 w-full" icon={!busy ? <ArrowRight className="size-4" /> : undefined}>
              {isRegister ? "Create workspace" : "Sign in"}
            </Button>
          </form>
          <p className="mt-6 text-[13px] text-muted">
            {isRegister ? "Already have an account? " : "New to NEXUS? "}
            <Link href={isRegister ? `/login${task ? `?task=${encodeURIComponent(task)}` : ""}` : `/register${task ? `?task=${encodeURIComponent(task)}` : ""}`} className="text-text underline-offset-4 hover:underline">
              {isRegister ? "Sign in" : "Create a workspace"}
            </Link>
          </p>
        </div>
      </div>
      <AuthAside />
    </div>
  );
}

/** The right half shows what the product does, as the product itself: a run's step ledger. */
function AuthAside() {
  const rows = [
    { agent: "Research", t: "3.8 s", note: "4 queries · 7 passages from pricing-2026.pdf", state: "done" },
    { agent: "Analyst", t: "6.1 s", note: "3 insights · confidence 0.82", state: "done" },
    { agent: "Reviewer", t: "2.4 s", note: "Sent back to Analyst: “compare the two tiers”", state: "revise" },
    { agent: "Analyst", t: "5.7 s", note: "Revision 1 · 4 insights", state: "done" },
    { agent: "Reviewer", t: "—", note: "Reviewing…", state: "live" },
  ];
  return (
    <div className="relative hidden overflow-hidden bg-[#1c1b1f] lg:flex lg:items-center lg:justify-center">
      <div data-ui className="w-[460px] rounded-[10px] bg-surface p-5 shadow-[var(--card-shadow)]">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-[14px] font-semibold">Pricing brief</p>
            <p className="text-[12px] text-muted">Research brief · run 7f3a19c2</p>
          </div>
          <span className="flex items-center gap-1.5 text-[12px] text-[var(--pill-thinking-ink)]">
            <span className="thinking-dot" /> Running
          </span>
        </div>
        <ol className="flex flex-col">
          {rows.map((r, i) => (
            <li key={i} className="grid grid-cols-[88px_1fr_52px] items-center gap-3 border-t border-rule py-2.5 text-[13px]">
              <span className="font-medium">{r.agent}</span>
              <span className={r.state === "live" ? "caret text-[var(--pill-thinking-ink)]" : r.state === "revise" ? "text-[var(--pill-warning-ink)]" : "text-muted"}>
                {r.note}
              </span>
              <span className="num text-right text-[12px] text-muted">{r.t}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
