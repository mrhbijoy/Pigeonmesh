"use client";
// Hero — PigeonMesh brand, one-paragraph pitch, live bridge status pill.

import { PigeonMark, GithubIcon } from "./icons";

export function Hero({ bridgeUrl }: { bridgeUrl: string }) {
  return (
    <header className="relative overflow-hidden border-b border-amber-500/15">
      {/* faint map-grid background */}
      <div
        aria-hidden
        className="absolute inset-0 opacity-[0.07]"
        style={{
          backgroundImage:
            "linear-gradient(to right, #f59e0b 1px, transparent 1px), linear-gradient(to bottom, #f59e0b 1px, transparent 1px)",
          backgroundSize: "32px 32px",
        }}
      />
      <div className="absolute -top-32 -right-32 h-96 w-96 rounded-full bg-amber-500/10 blur-3xl" />
      <div className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full bg-red-500/10 blur-3xl" />

      <div className="relative mx-auto max-w-6xl px-4 py-8 sm:py-12">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <PigeonMark className="h-10 w-10" />
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
                PigeonMesh <span className="text-amber-400">Cloud Bridge</span>
              </h1>
              <p className="text-xs text-slate-400 sm:text-sm">
                Communication that survives the shutdown.
              </p>
            </div>
          </div>
          <a
            href="https://github.com/pigeonmesh"
            target="_blank"
            rel="noreferrer"
            className="hidden rounded-md border border-slate-700 px-3 py-1.5 text-xs text-slate-300 transition hover:bg-slate-800 sm:inline-flex sm:items-center sm:gap-2"
          >
            <GithubIcon /> Source
          </a>
        </div>

        <div className="mt-6 max-w-3xl">
          <p className="text-sm leading-relaxed text-slate-300 sm:text-base">
            A public, Vercel-deployed mesh peer that bridges internet-connected routers
            to the global coordination dashboard. When a flood cuts a district in half,
            people carry records across the gap on their phones. When a router
            somewhere gets a satellite uplink, the bridge lets coordinators see every
            SOS, missing-person report and check-in from every connected mesh — live.
          </p>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3 text-xs">
          <StatusPill label="Bridge online" tone="ok" />
          <span className="rounded-full border border-slate-700 px-3 py-1 font-mono text-[11px] text-slate-400">
            {bridgeUrl || "https://your-app.vercel.app"}
          </span>
          <span className="rounded-full border border-amber-500/30 bg-amber-500/5 px-3 py-1 text-amber-300">
            GPL-2.0 · Bangla-first
          </span>
        </div>
      </div>
    </header>
  );
}

function StatusPill({ label, tone }: { label: string; tone: "ok" | "warn" }) {
  const dot = tone === "ok" ? "bg-emerald-400" : "bg-amber-400";
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/5 px-3 py-1 text-emerald-300">
      <span className={`relative inline-flex h-2 w-2`}>
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${dot} opacity-75`} />
        <span className={`relative inline-flex h-2 w-2 rounded-full ${dot}`} />
      </span>
      {label}
    </span>
  );
}
