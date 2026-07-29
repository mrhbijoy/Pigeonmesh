"use client";
// PigeonMesh Cloud — full online mesh client + coordinator dashboard.
// Mobile-first, dark crisis aesthetic, Bangla + English.
// All in one page: Feed | Chat | SOS | People | Mesh

import { useEffect, useState, useRef, useCallback } from "react";

type Tab = "feed" | "chat" | "sos" | "people" | "mesh";

export default function Home() {
  const [tab, setTab] = useState<Tab>("feed");
  const [nick, setNick] = useState("");
  const [records, setRecords] = useState<PmRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const pausedRef = useRef(false);

  // Load nick from localStorage
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("pm-nick") : null;
    if (saved) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNick(saved);
    }
  }, []);

  // SSE subscription — live records
  useEffect(() => {
    pausedRef.current = false;
    const es = new EventSource("/api/pigeonmesh/events");
    es.addEventListener("hello", () => setConnected(true));
    es.addEventListener("seed", (e: MessageEvent) => {
      try {
        const j = JSON.parse(e.data);
        if (Array.isArray(j.records)) setRecords(dedupe([...j.records]).slice(0, 100));
      } catch {}
    });
    es.addEventListener("record", (e: MessageEvent) => {
      if (pausedRef.current) return;
      try {
        const rec = JSON.parse(e.data) as PmRecord;
        setRecords((prev) => dedupe([rec, ...prev]).slice(0, 100));
        // Soft notification buzz on SOS
        if (rec.kind === "sos" && typeof window !== "undefined") {
          try { window.navigator.vibrate?.(200); } catch {}
        }
      } catch {}
    });
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);

  const showToast = useCallback((msg: string, type: "ok" | "err" = "ok") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const postRecord = useCallback(async (rec: any) => {
    try {
      const r = await fetch("/api/pigeonmesh/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [rec] }),
      });
      const j = await r.json();
      if (j.accepted?.length) {
        showToast("✓ পাঠানো হয়েছে", "ok");
        return true;
      } else {
        showToast(`⚠ ${j.rejected?.[0]?.why || "বাতিল"}`, "err");
        return false;
      }
    } catch (e) {
      showToast(`⚠ ${(e as Error).message}`, "err");
      return false;
    }
  }, [showToast]);

  const saveNick = (n: string) => {
    setNick(n);
    if (typeof window !== "undefined") localStorage.setItem("pm-nick", n);
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-100 flex flex-col">
      <Header connected={connected} nick={nick} onNick={saveNick} />
      <nav className="sticky top-0 z-20 flex border-b border-slate-800 bg-[#0a0f1e]/95 backdrop-blur-md">
        <TabBtn active={tab === "feed"} onClick={() => setTab("feed")} icon="📡" label="Feed" />
        <TabBtn active={tab === "chat"} onClick={() => setTab("chat")} icon="💬" label="Chat" />
        <TabBtn active={tab === "sos"} onClick={() => setTab("sos")} icon="🚨" label="SOS" />
        <TabBtn active={tab === "people"} onClick={() => setTab("people")} icon="👥" label="People" />
        <TabBtn active={tab === "mesh"} onClick={() => setTab("mesh")} icon="🕸️" label="Mesh" />
      </nav>

      {toast && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${toast.type === "ok" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"}`}>
          {toast.msg}
        </div>
      )}

      <main className="flex-1 mx-auto w-full max-w-3xl px-3 py-4 pb-24">
        {tab === "feed" && <FeedTab records={records} />}
        {tab === "chat" && <ChatTab nick={nick} onNick={saveNick} post={postRecord} records={records} />}
        {tab === "sos" && <SosTab nick={nick} post={postRecord} records={records} />}
        {tab === "people" && <PeopleTab nick={nick} post={postRecord} records={records} />}
        {tab === "mesh" && <MeshTab />}
      </main>
      <Footer />
    </div>
  );
}

// ============================== HEADER ==============================
function Header({ connected, nick, onNick }: { connected: boolean; nick: string; onNick: (n: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nick);
  return (
    <header className="border-b border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-red-500/10">
      <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🕊️</span>
          <div>
            <h1 className="text-base font-bold tracking-tight">PigeonMesh</h1>
            <p className="text-[10px] text-slate-400 -mt-0.5">যোগাযোগ যেটা শাটডাউনেও কাজ করে</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={32}
                className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs outline-none focus:border-amber-500"
                placeholder="নাম"
              />
              <button
                onClick={() => { onNick(draft.trim() || "anon"); setEditing(false); }}
                className="rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-[#0a0f1e]"
              >✓</button>
            </div>
          ) : (
            <button
              onClick={() => { setDraft(nick); setEditing(true); }}
              className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {nick ? `👤 ${nick}` : "👤 নাম দিন"}
            </button>
          )}
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ${connected ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
            {connected ? "live" : "off"}
          </span>
        </div>
      </div>
    </header>
  );
}

function TabBtn({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: string; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 flex flex-col items-center py-2 text-[10px] font-medium transition ${active ? "text-amber-400 border-b-2 border-amber-400" : "text-slate-500 hover:text-slate-300"}`}
    >
      <span className="text-base mb-0.5">{icon}</span>
      {label}
    </button>
  );
}

// ============================== FEED ==============================
function FeedTab({ records }: { records: PmRecord[] }) {
  const [filter, setFilter] = useState("all");
  const filtered = filter === "all" ? records : records.filter((r) => r.kind === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-3 px-3">
        {["all", "sos", "chat", "checkin", "missing", "bulletin"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium ${filter === f ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30" : "bg-slate-900 text-slate-400"}`}
          >
            {f === "all" ? "সব" : f}
          </button>
        ))}
        <span className="ml-auto shrink-0 text-[10px] text-slate-600">{filtered.length} টা</span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => <RecordCard key={r.id} r={r} />)}
        </ul>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
      <div className="text-5xl mb-3">📡</div>
      <p className="text-sm text-slate-400 font-medium">এখনও কোনো মেসেজ নেই</p>
      <p className="text-xs text-slate-600 mt-1">Chat ট্যাবে গিয়ে প্রথম মেসেজ পাঠাও</p>
    </div>
  );
}

/** Compact list of recent records, shown in Chat/SOS/People tabs so the
 *  user sees relevant history without switching to the Feed tab. */
function RecentRecords({ records, title, emptyMsg }: { records: PmRecord[]; title: string; emptyMsg: string }) {
  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800/50 bg-slate-900/30 p-4 text-center">
        <p className="text-xs text-slate-500">{emptyMsg}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wide px-1">{title} · {records.length}</h3>
      <ul className="space-y-1.5">
        {records.map((r) => <RecordCard key={r.id} r={r} />)}
      </ul>
    </div>
  );
}

function RecordCard({ r }: { r: PmRecord }) {
  const body = parseBody(r.body);
  const text = (typeof body?.text === "string" && body.text) || (typeof body?.msg === "string" && body.msg) || (typeof body?.name === "string" && body.name) || "";
  const geo = body?.lat != null && body?.lon != null ? `${body.lat}, ${body.lon}` : null;
  const style = kindStyle(r.kind);

  return (
    <li className={`rounded-xl border p-3 ${style.border} ${style.bg}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={`text-base ${style.icon}`}>{kindIcon(r.kind)}</span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{r.kind}</span>
        <span className="font-semibold text-sm text-slate-200">{r.nick || "anon"}</span>
        <span className="font-mono text-[10px] text-slate-600">#{r.chan || "public"}</span>
        {r.origin && r.origin !== "cloud" && (
          <span className="font-mono text-[9px] text-slate-700">via {r.origin}</span>
        )}
        <span className="ml-auto text-[10px] text-slate-500">{timeAgo(r.ts)}</span>
      </div>
      {text && <p className="text-sm break-words text-slate-100">{text}</p>}
      {body?.need && <span className="inline-block mt-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">need: {body.need}</span>}
      {body?.where && <span className="inline-block mt-1 ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">📍 {body.where}</span>}
      {geo && <p className="mt-1 font-mono text-[10px] text-slate-500">📍 {geo}</p>}
    </li>
  );
}

// ============================== CHAT ==============================
function ChatTab({ nick, onNick, post, records }: { nick: string; onNick: (n: string) => void; post: (rec: any) => Promise<boolean>; records: PmRecord[] }) {
  const [text, setText] = useState("");
  const [chan, setChan] = useState("general");
  const [sending, setSending] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    const finalNick = nick || "anon";
    onNick(finalNick);
    const id = cryptoRandomHex(16);
    const ts = Math.floor(Date.now() / 1000);
    const ok = await post({
      id, kind: "chat", ts, exp: ts + 3 * 24 * 3600,
      chan, nick: finalNick, origin: "cloud",
      body: { text: text.trim() },
    });
    if (ok) setText("");
    setSending(false);
  };

  const chatRecords = records.filter((r) => r.kind === "chat").slice(0, 8);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
        <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">আপনার নাম</label>
        <input
          value={nick}
          onChange={(e) => onNick(e.target.value)}
          maxLength={32}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-500"
          placeholder="নাম লিখুন"
        />
      </div>

      <form onSubmit={send} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">চ্যানেল</label>
          <div className="flex gap-1.5 flex-wrap">
            {[
              { id: "general", label: "সাধারণ" },
              { id: "relief", label: "রিলিফ" },
              { id: "medical", label: "মেডিকেল" },
              { id: "bulletin", label: "বুলেটিন" },
            ].map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChan(c.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${chan === c.id ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40" : "bg-slate-800 text-slate-400"}`}
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">মেসেজ</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={900}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-500 resize-none"
            placeholder="মেসেজ লিখুন…"
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-600">{text.length}/900 · #{chan}</span>
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="rounded-lg bg-amber-500 px-5 py-2 text-xs font-bold text-[#0a0f1e] disabled:opacity-40 hover:bg-amber-400 transition"
          >
            {sending ? "পাঠানো হচ্ছে…" : "📤 পাঠান"}
          </button>
        </div>
      </form>

      <RecentRecords records={chatRecords} title="💬 সাম্প্রতিক চ্যাট" emptyMsg="এখনও কোনো চ্যাট নেই" />
    </div>
  );
}

// ============================== SOS ==============================
function SosTab({ nick, post, records }: { nick: string; post: (rec: any) => Promise<boolean>; records: PmRecord[] }) {
  const [text, setText] = useState("");
  const [need, setNeed] = useState("rescue");
  const [sending, setSending] = useState(false);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const send = async () => {
    if (sending) return;
    setSending(true);
    const id = cryptoRandomHex(16);
    const ts = Math.floor(Date.now() / 1000);
    const ok = await post({
      id, kind: "sos", ts, exp: ts + 24 * 3600,
      chan: "sos", nick: nick || "emergency", origin: "cloud-sos",
      body: { text: text || "জরুরি সাহায্য দরকার", need, source: "cloud" },
    });
    if (ok) {
      setLastSent(id);
      setText("");
    }
    setSending(false);
  };

  const sosRecords = records.filter((r) => r.kind === "sos").slice(0, 10);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border-2 border-red-500/40 bg-gradient-to-b from-red-500/10 to-red-500/5 p-4 text-center">
        <div className="text-5xl mb-2">🚨</div>
        <h2 className="text-lg font-bold text-red-300">জরুরি SOS</h2>
        <p className="text-xs text-red-200/70 mt-1">সব কানেক্টেড ফোনে ও রাউটারে তাৎক্ষণিক এলার্ট যাবে</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3">
        <div>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">কী হয়েছে</label>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
            placeholder="যেমন: ছাদে আটকে আছি, পানি বাড়ছে"
          />
        </div>

        <div>
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">কী দরকার</label>
          <div className="flex flex-wrap gap-1.5">
            {[
              { id: "rescue", label: "🚁 উদ্ধার" },
              { id: "medical", label: "⚕️ চিকিৎসা" },
              { id: "food", label: "🍚 খাবার" },
              { id: "water", label: "💧 পানি" },
              { id: "shelter", label: "🏠 আশ্রয়" },
              { id: "boat", label: "🚤 নৌকা" },
            ].map((n) => (
              <button
                key={n.id}
                onClick={() => setNeed(n.id)}
                className={`rounded-full px-3 py-1.5 text-xs ${need === n.id ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/40" : "bg-slate-800 text-slate-400"}`}
              >
                {n.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={send}
          disabled={sending}
          className="w-full rounded-xl bg-gradient-to-r from-red-500 to-red-600 py-3.5 text-sm font-bold text-white hover:from-red-600 hover:to-red-700 disabled:opacity-50 transition shadow-lg shadow-red-500/20"
        >
          {sending ? "পাঠানো হচ্ছে…" : "🚨 SOS পাঠান"}
        </button>

        {lastSent && (
          <p className="text-[11px] text-emerald-400 font-mono break-all">
            ✓ পাঠানো হয়েছে — id: {lastSent}
          </p>
        )}
      </div>

      <RecentRecords records={sosRecords} title="🚨 সক্রিয় SOS" emptyMsg="এখনও কোনো SOS নেই" />
    </div>
  );
}

// ============================== PEOPLE ==============================
function PeopleTab({ nick, post, records }: { nick: string; post: (rec: any) => Promise<boolean>; records: PmRecord[] }) {
  const [tab, setTab] = useState<"safe" | "missing">("safe");
  const safeRecords = records.filter((r) => r.kind === "checkin").slice(0, 10);
  const missingRecords = records.filter((r) => r.kind === "missing").slice(0, 10);
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button onClick={() => setTab("safe")} className={`flex-1 rounded-lg py-2.5 text-xs font-bold ${tab === "safe" ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40" : "bg-slate-900 text-slate-400"}`}>
          ✅ আমি নিরাপদ
        </button>
        <button onClick={() => setTab("missing")} className={`flex-1 rounded-lg py-2.5 text-xs font-bold ${tab === "missing" ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40" : "bg-slate-900 text-slate-400"}`}>
          👤 নিখোঁজ রিপোর্ট
        </button>
      </div>
      {tab === "safe" ? (
        <>
          <SafeCheckin nick={nick} post={post} />
          <RecentRecords records={safeRecords} title="✅ নিরাপদ চেক-ইন" emptyMsg="এখনও কেউ চেক-ইন করেননি" />
        </>
      ) : (
        <>
          <MissingReport nick={nick} post={post} />
          <RecentRecords records={missingRecords} title="👤 নিখোঁজ ব্যক্তি" emptyMsg="কোনো নিখোঁজ রিপোর্ট নেই" />
        </>
      )}
    </div>
  );
}

function SafeCheckin({ nick, post }: { nick: string; post: (rec: any) => Promise<boolean> }) {
  const [name, setName] = useState(nick);
  const [where, setWhere] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (sending) return;
    setSending(true);
    const id = cryptoRandomHex(16);
    const ts = Math.floor(Date.now() / 1000);
    await post({
      id, kind: "checkin", ts, exp: ts + 7 * 24 * 3600,
      chan: "checkin", nick: name || "anon", origin: "cloud",
      body: { text: `${name || "অজ্ঞাত"} নিরাপদ আছেন — অবস্থান: ${where}`, where },
    });
    setWhere("");
    setSending(false);
  };

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3">
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">নাম</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">আপনি কোথায়?</label>
        <input value={where} onChange={(e) => setWhere(e.target.value)} maxLength={80} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="যেমন: কালীবাড়ি স্কুল শেল্টার" />
      </div>
      <button onClick={send} disabled={sending} className="w-full rounded-lg bg-emerald-500 py-3 text-sm font-bold text-[#0a0f1e] hover:bg-emerald-400 disabled:opacity-50">
        {sending ? "…" : "✅ আমি নিরাপদ"}
      </button>
    </div>
  );
}

function MissingReport({ nick, post }: { nick: string; post: (rec: any) => Promise<boolean> }) {
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [desc, setDesc] = useState("");
  const [contact, setContact] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (sending || !name) return;
    setSending(true);
    const id = cryptoRandomHex(16);
    const ts = Math.floor(Date.now() / 1000);
    await post({
      id, kind: "missing", ts, exp: ts + 30 * 24 * 3600,
      chan: "missing", nick: name, origin: "cloud",
      body: { text: `${name}, ${age} — ${desc}. যোগাযোগ: ${contact}`, name, age, desc, contact },
    });
    setName(""); setAge(""); setDesc(""); setContact("");
    setSending(false);
  };

  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 space-y-3">
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">নিখোঁজ ব্যক্তির নাম</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1">
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">বয়স</label>
          <input value={age} onChange={(e) => setAge(e.target.value)} type="number" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">যোগাযোগ</label>
          <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={60} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500" placeholder="ফোন" />
        </div>
      </div>
      <div>
        <label className="block text-[11px] uppercase tracking-wide text-slate-400 mb-1.5">বর্ণনা</label>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} rows={2} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500 resize-none" placeholder="পরিচয়, পোশাক, শেষ দেখা হয়েছিল কোথায়…" />
      </div>
      <button onClick={send} disabled={sending || !name} className="w-full rounded-lg bg-sky-500 py-3 text-sm font-bold text-[#0a0f1e] hover:bg-sky-400 disabled:opacity-50">
        {sending ? "…" : "👤 রিপোর্ট করুন"}
      </button>
    </div>
  );
}

// ============================== MESH ==============================
function MeshTab() {
  const [state, setState] = useState<any>(null);
  const [topo, setTopo] = useState<any>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const [s, t] = await Promise.all([
          fetch("/api/pigeonmesh/state").then((r) => r.json()),
          fetch("/api/pigeonmesh/topology").then((r) => r.json()),
        ]);
        setState(s); setTopo(t);
      } catch {}
    };
    poll();
    const id = setInterval(poll, 10000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-3">
      {state && (
        <div className="grid grid-cols-2 gap-2">
          <Stat label="মোট রেকর্ড" value={state.store?.records || 0} />
          <Stat label="পিয়ার রাউটার" value={state.peers?.length || 0} />
          <Stat label="SOS" value={state.counts?.sos || 0} color="text-red-400" />
          <Stat label="চেক-ইন" value={state.counts?.checkin || 0} color="text-emerald-400" />
        </div>
      )}

      {topo && topo.nodes && topo.nodes.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <h3 className="text-xs font-semibold text-slate-300 mb-2">🕸️ মেশ টপোলজি</h3>
          <ul className="space-y-1.5">
            {topo.nodes.map((n: any) => (
              <li key={n.node} className="flex items-center justify-between text-xs bg-slate-950/50 rounded px-2 py-1.5">
                <div>
                  <span className="font-mono text-slate-300">{n.node}</span>
                  {n.self && <span className="ml-1 text-[9px] text-amber-400">(self)</span>}
                </div>
                <div className="text-right">
                  <div className="text-slate-400">{n.name}</div>
                  <div className="text-[9px] text-slate-600">{n.records ?? 0} rec</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
        <h3 className="text-xs font-semibold text-amber-300 mb-1">🌐 ব্রিজ URL</h3>
        <p className="font-mono text-[11px] text-amber-200 break-all">{typeof window !== "undefined" ? window.location.origin : ""}/api/pigeonmesh/sync</p>
        <p className="text-[10px] text-amber-200/60 mt-1">যেকোনো PigeonMesh রাউটার এই URL এ sync করতে পারে</p>
      </div>
    </div>
  );
}

function Stat({ label, value, color = "text-slate-100" }: { label: string; value: number; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

// ============================== FOOTER ==============================
function Footer() {
  return (
    <footer className="border-t border-slate-800 py-3 text-center text-[10px] text-slate-600">
      PigeonMesh · GPL-2.0 · মেমোরিয়াল পোর্ট ৩৬০৭ · যোগাযোগ
    </footer>
  );
}

// ============================== HELPERS ==============================
function dedupe(recs: PmRecord[]): PmRecord[] {
  const seen = new Set<string>();
  const out: PmRecord[] = [];
  for (const r of recs) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push(r);
  }
  return out;
}

function parseBody(b: PmRecord["body"]): Record<string, unknown> | null {
  if (!b) return null;
  if (typeof b === "string") { try { return JSON.parse(b); } catch { return { text: b }; } }
  return b as Record<string, unknown>;
}

function timeAgo(ts: number): string {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 5) return "এখন";
  if (s < 60) return `${s}সে`;
  if (s < 3600) return `${Math.floor(s / 60)}মি`;
  if (s < 86400) return `${Math.floor(s / 3600)}ঘ`;
  return `${Math.floor(s / 86400)}দি`;
}

function kindIcon(k: string): string {
  return ({ sos: "🚨", chat: "💬", checkin: "✅", missing: "👤", bulletin: "📢", pin: "📍", dm: "🔒", ack: "✓", profile: "👤", presence: "●" } as Record<string, string>)[k] || "📄";
}

function kindStyle(k: string): { border: string; bg: string; icon: string } {
  return ({
    sos:      { border: "border-red-500/40",     bg: "bg-red-500/10",     icon: "" },
    chat:     { border: "border-slate-700",       bg: "bg-slate-800/30",   icon: "" },
    checkin:  { border: "border-emerald-500/40",  bg: "bg-emerald-500/10", icon: "" },
    missing:  { border: "border-sky-500/40",      bg: "bg-sky-500/10",     icon: "" },
    bulletin: { border: "border-amber-500/40",    bg: "bg-amber-500/10",   icon: "" },
    pin:      { border: "border-fuchsia-500/40",  bg: "bg-fuchsia-500/10", icon: "" },
    dm:       { border: "border-pink-500/40",     bg: "bg-pink-500/10",    icon: "" },
  } as Record<string, { border: string; bg: string; icon: string }>)[k] || { border: "border-slate-700", bg: "bg-slate-800/30", icon: "" };
}

function cryptoRandomHex(bytes: number): string {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const a = new Uint8Array(bytes);
    crypto.getRandomValues(a);
    return Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  let s = "";
  for (let i = 0; i < bytes * 2; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

interface PmRecord {
  id: string;
  kind: string;
  ts: number;
  exp?: number;
  chan?: string;
  nick?: string;
  author?: string;
  origin?: string;
  body?: Record<string, unknown> | string;
}
