"use client";
// PigeonMesh Cloud — online mesh client + coordinator dashboard.
// Mobile-first, dark crisis aesthetic. One page: Feed | Chat | SOS | People | Mesh.
//
// Every visible string comes from lib/pigeonmesh/i18n, so the page is Bangla
// or English throughout and never a mix of the two.

import { useEffect, useState, useRef, useCallback, useSyncExternalStore } from "react";
import { useI18n, initLang, kindKey, LANG_NAME, type Lang, type Key } from "@/lib/pigeonmesh/i18n";

type Tab = "feed" | "chat" | "sos" | "people" | "mesh";
type T = (k: Key) => string;
type N = (v: number | string) => string;

export default function Home() {
  const [tab, setTab] = useState<Tab>("feed");
  const [nick, setNick] = useState("");
  const [records, setRecords] = useState<PmRecord[]>([]);
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);
  const pausedRef = useRef(false);
  const { t, n } = useI18n();

  // Restore the saved language and nickname. Both have to wait for mount:
  // reading localStorage during render would disagree with the server paint.
  useEffect(() => {
    initLang();
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

  const postRecord = useCallback(async (rec: Record<string, unknown>) => {
    try {
      const r = await fetch("/api/pigeonmesh/records", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records: [rec] }),
      });
      const j = await r.json();
      if (j.accepted?.length) {
        showToast(`✓ ${t("sent_ok")}`, "ok");
        return true;
      }
      // The reason a node gives is a machine string; show it, but label it in
      // the reader's language so the line is not half one and half the other.
      showToast(`⚠ ${t("rejected")}${j.rejected?.[0]?.why ? `: ${j.rejected[0].why}` : ""}`, "err");
      return false;
    } catch (e) {
      showToast(`⚠ ${(e as Error).message}`, "err");
      return false;
    }
  }, [showToast, t]);

  const saveNick = (v: string) => {
    setNick(v);
    if (typeof window !== "undefined") localStorage.setItem("pm-nick", v);
  };

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-slate-100 flex flex-col">
      <Header connected={connected} nick={nick} onNick={saveNick} />
      <nav className="sticky top-0 z-20 flex border-b border-slate-800 bg-[#0a0f1e]/95 backdrop-blur-md">
        <TabBtn active={tab === "feed"} onClick={() => setTab("feed")} icon="📡" label={t("tab_feed")} />
        <TabBtn active={tab === "chat"} onClick={() => setTab("chat")} icon="💬" label={t("tab_chat")} />
        <TabBtn active={tab === "sos"} onClick={() => setTab("sos")} icon="🚨" label={t("tab_sos")} />
        <TabBtn active={tab === "people"} onClick={() => setTab("people")} icon="👥" label={t("tab_people")} />
        <TabBtn active={tab === "mesh"} onClick={() => setTab("mesh")} icon="🕸️" label={t("tab_mesh")} />
      </nav>

      {toast && (
        <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-50 rounded-lg px-4 py-2 text-sm font-medium shadow-lg ${toast.type === "ok" ? "bg-emerald-500 text-white" : "bg-red-500 text-white"}`}>
          {toast.msg}
        </div>
      )}

      <main className="flex-1 mx-auto w-full max-w-3xl px-3 py-4 pb-24">
        {tab === "feed" && <FeedTab records={records} t={t} n={n} />}
        {tab === "chat" && <ChatTab nick={nick} onNick={saveNick} post={postRecord} records={records} t={t} n={n} />}
        {tab === "sos" && <SosTab nick={nick} post={postRecord} records={records} t={t} n={n} />}
        {tab === "people" && <PeopleTab nick={nick} post={postRecord} records={records} t={t} n={n} />}
        {tab === "mesh" && <MeshTab t={t} n={n} />}
      </main>
      <Footer t={t} />
    </div>
  );
}

// ============================== HEADER ==============================
function Header({ connected, nick, onNick }: { connected: boolean; nick: string; onNick: (v: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(nick);
  const { lang, t, setLang } = useI18n();
  const other: Lang = lang === "bn" ? "en" : "bn";

  return (
    <header className="border-b border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-orange-500/5 to-red-500/10">
      <div className="mx-auto max-w-3xl px-4 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <span className="text-2xl">🕊️</span>
          <div>
            <h1 className="text-base font-bold tracking-tight">PigeonMesh</h1>
            <p className="text-[10px] text-slate-400 -mt-0.5">{t("tagline")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Names where it goes, not where you are. */}
          <button
            onClick={() => setLang(other)}
            className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
          >
            {LANG_NAME[other]}
          </button>
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={32}
                className="w-28 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs outline-none focus:border-amber-500"
                placeholder={t("name")}
              />
              <button
                onClick={() => { onNick(draft.trim() || t("anon")); setEditing(false); }}
                className="rounded bg-amber-500 px-2 py-1 text-xs font-semibold text-[#0a0f1e]"
              >✓</button>
            </div>
          ) : (
            <button
              onClick={() => { setDraft(nick); setEditing(true); }}
              className="rounded-full border border-slate-700 px-2.5 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              {nick ? `👤 ${nick}` : `👤 ${t("set_name")}`}
            </button>
          )}
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] ${connected ? "bg-emerald-500/15 text-emerald-300" : "bg-slate-800 text-slate-400"}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? "animate-pulse bg-emerald-400" : "bg-slate-500"}`} />
            {connected ? t("live") : t("off")}
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
const FEED_FILTERS = ["all", "sos", "chat", "checkin", "missing", "bulletin"] as const;

function FeedTab({ records, t, n }: { records: PmRecord[]; t: T; n: N }) {
  const [filter, setFilter] = useState<string>("all");
  const filtered = filter === "all" ? records : records.filter((r) => r.kind === filter);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-3 px-3">
        {FEED_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`shrink-0 rounded-full px-3 py-1 text-[11px] font-medium ${filter === f ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/30" : "bg-slate-900 text-slate-400"}`}
          >
            {f === "all" ? t("filter_all") : t(kindKey(f))}
          </button>
        ))}
        <span className="ml-auto shrink-0 text-[10px] text-slate-600">
          {n(filtered.length)} {t("count_items")}
        </span>
      </div>

      {filtered.length === 0 ? (
        <EmptyState t={t} />
      ) : (
        <ul className="space-y-2">
          {filtered.map((r) => <RecordCard key={r.id} r={r} t={t} n={n} />)}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ t }: { t: T }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-8 text-center">
      <div className="text-5xl mb-3">📡</div>
      <p className="text-sm text-slate-400 font-medium">{t("empty_feed")}</p>
      <p className="text-xs text-slate-600 mt-1">{t("empty_feed_hint")}</p>
    </div>
  );
}

/** Compact list of recent records, shown in Chat/SOS/People tabs so the
 *  user sees relevant history without switching to the Feed tab. */
function RecentRecords({ records, title, emptyMsg, t, n }: {
  records: PmRecord[]; title: string; emptyMsg: string; t: T; n: N;
}) {
  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-slate-800/50 bg-slate-900/30 p-4 text-center">
        <p className="text-xs text-slate-500">{emptyMsg}</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold text-slate-400 tracking-wide px-1">
        {title} · {n(records.length)}
      </h3>
      <ul className="space-y-1.5">
        {records.map((r) => <RecordCard key={r.id} r={r} t={t} n={n} />)}
      </ul>
    </div>
  );
}

function RecordCard({ r, t, n }: { r: PmRecord; t: T; n: N }) {
  const body = parseBody(r.body);
  const text = (typeof body?.text === "string" && body.text)
    || (typeof body?.msg === "string" && body.msg)
    || (typeof body?.name === "string" && body.name)
    || "";
  const geo = body?.lat != null && body?.lon != null ? `${body.lat}, ${body.lon}` : null;
  const style = kindStyle(r.kind);
  const need = typeof body?.need === "string" ? body.need : null;

  return (
    <li className={`rounded-xl border p-3 ${style.border} ${style.bg}`}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="text-base">{kindIcon(r.kind)}</span>
        <span className="text-[10px] font-bold tracking-wide text-slate-400">{t(kindKey(r.kind))}</span>
        <span className="font-semibold text-sm text-slate-200">{r.nick || t("anon")}</span>
        {r.origin && r.origin !== "cloud" && (
          <span className="font-mono text-[9px] text-slate-700">{t("via")} {r.origin}</span>
        )}
        <span className="ml-auto text-[10px] text-slate-500">{timeAgo(r.ts, t, n)}</span>
      </div>
      {text && <p className="text-sm break-words text-slate-100">{text}</p>}
      {need && (
        <span className="inline-block mt-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] text-red-300">
          {t("need_label")}: {t(needKey(need))}
        </span>
      )}
      {typeof body?.where === "string" && body.where && (
        <span className="inline-block mt-1 ml-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] text-emerald-300">
          📍 {body.where}
        </span>
      )}
      {geo && <p className="mt-1 font-mono text-[10px] text-slate-500">📍 {n(geo)}</p>}
    </li>
  );
}

// ============================== CHAT ==============================
const CHANNELS = [
  { id: "general", key: "ch_general" },
  { id: "relief", key: "ch_relief" },
  { id: "medical", key: "ch_medical" },
  { id: "bulletin", key: "ch_bulletin" },
] as const;

function ChatTab({ nick, onNick, post, records, t, n }: {
  nick: string; onNick: (v: string) => void;
  post: (rec: Record<string, unknown>) => Promise<boolean>;
  records: PmRecord[]; t: T; n: N;
}) {
  const [text, setText] = useState("");
  const [chan, setChan] = useState("general");
  const [sending, setSending] = useState(false);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    const finalNick = nick || t("anon");
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
        <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("your_name")}</label>
        <input
          value={nick}
          onChange={(e) => onNick(e.target.value)}
          maxLength={32}
          className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-500"
          placeholder={t("name_placeholder")}
        />
      </div>

      <form onSubmit={send} className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3">
        <div>
          <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("channel")}</label>
          <div className="flex gap-1.5 flex-wrap">
            {CHANNELS.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setChan(c.id)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${chan === c.id ? "bg-amber-500/20 text-amber-300 ring-1 ring-amber-500/40" : "bg-slate-800 text-slate-400"}`}
              >
                {t(c.key)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("message")}</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={900}
            rows={3}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-amber-500 resize-none"
            placeholder={t("message_placeholder")}
          />
        </div>

        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-600">
            {n(text.length)}/{n(900)} · {t(CHANNELS.find((c) => c.id === chan)?.key ?? "ch_general")}
          </span>
          <button
            type="submit"
            disabled={!text.trim() || sending}
            className="rounded-lg bg-amber-500 px-5 py-2 text-xs font-bold text-[#0a0f1e] disabled:opacity-40 hover:bg-amber-400 transition"
          >
            {sending ? t("sending") : `📤 ${t("send")}`}
          </button>
        </div>
      </form>

      <RecentRecords records={chatRecords} title={`💬 ${t("recent_chat")}`} emptyMsg={t("no_chat")} t={t} n={n} />
    </div>
  );
}

// ============================== SOS ==============================
const NEEDS = [
  { id: "rescue", icon: "🚁", key: "need_rescue" },
  { id: "medical", icon: "⚕️", key: "need_medical" },
  { id: "food", icon: "🍚", key: "need_food" },
  { id: "water", icon: "💧", key: "need_water" },
  { id: "shelter", icon: "🏠", key: "need_shelter" },
  { id: "boat", icon: "🚤", key: "need_boat" },
] as const;

function needKey(id: string): Key {
  return (NEEDS.find((x) => x.id === id)?.key ?? "kind_other") as Key;
}

function SosTab({ nick, post, records, t, n }: {
  nick: string; post: (rec: Record<string, unknown>) => Promise<boolean>;
  records: PmRecord[]; t: T; n: N;
}) {
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
      chan: "sos", nick: nick || t("anon"), origin: "cloud-sos",
      body: { text: text || t("sos_default_text"), need, source: "cloud" },
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
        <h2 className="text-lg font-bold text-red-300">{t("sos_title")}</h2>
        <p className="text-xs text-red-200/70 mt-1">{t("sos_note")}</p>
      </div>

      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3 space-y-3">
        <div>
          <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("sos_what")}</label>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={200}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-red-500"
            placeholder={t("sos_what_placeholder")}
          />
        </div>

        <div>
          <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("sos_need")}</label>
          <div className="flex flex-wrap gap-1.5">
            {NEEDS.map((x) => (
              <button
                key={x.id}
                onClick={() => setNeed(x.id)}
                className={`rounded-full px-3 py-1.5 text-xs ${need === x.id ? "bg-red-500/20 text-red-300 ring-1 ring-red-500/40" : "bg-slate-800 text-slate-400"}`}
              >
                {x.icon} {t(x.key)}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={send}
          disabled={sending}
          className="w-full rounded-xl bg-gradient-to-r from-red-500 to-red-600 py-3.5 text-sm font-bold text-white hover:from-red-600 hover:to-red-700 disabled:opacity-50 transition shadow-lg shadow-red-500/20"
        >
          {sending ? t("sending") : `🚨 ${t("sos_send")}`}
        </button>

        {lastSent && (
          <p className="text-[11px] text-emerald-400 font-mono break-all">
            ✓ {t("sent_ok")} — {lastSent}
          </p>
        )}
      </div>

      <RecentRecords records={sosRecords} title={`🚨 ${t("sos_active")}`} emptyMsg={t("no_sos")} t={t} n={n} />
    </div>
  );
}

// ============================== PEOPLE ==============================
function PeopleTab({ nick, post, records, t, n }: {
  nick: string; post: (rec: Record<string, unknown>) => Promise<boolean>;
  records: PmRecord[]; t: T; n: N;
}) {
  const [tab, setTab] = useState<"safe" | "missing">("safe");
  const safeRecords = records.filter((r) => r.kind === "checkin").slice(0, 10);
  const missingRecords = records.filter((r) => r.kind === "missing").slice(0, 10);
  return (
    <div className="space-y-3">
      <div className="flex gap-1.5">
        <button onClick={() => setTab("safe")} className={`flex-1 rounded-lg py-2.5 text-xs font-bold ${tab === "safe" ? "bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40" : "bg-slate-900 text-slate-400"}`}>
          ✅ {t("tab_safe")}
        </button>
        <button onClick={() => setTab("missing")} className={`flex-1 rounded-lg py-2.5 text-xs font-bold ${tab === "missing" ? "bg-sky-500/20 text-sky-300 ring-1 ring-sky-500/40" : "bg-slate-900 text-slate-400"}`}>
          👤 {t("tab_missing")}
        </button>
      </div>
      {tab === "safe" ? (
        <>
          <SafeCheckin nick={nick} post={post} t={t} />
          <RecentRecords records={safeRecords} title={`✅ ${t("recent_safe")}`} emptyMsg={t("no_safe")} t={t} n={n} />
        </>
      ) : (
        <>
          <MissingReport post={post} t={t} />
          <RecentRecords records={missingRecords} title={`👤 ${t("recent_missing")}`} emptyMsg={t("no_missing")} t={t} n={n} />
        </>
      )}
    </div>
  );
}

function SafeCheckin({ nick, post, t }: {
  nick: string; post: (rec: Record<string, unknown>) => Promise<boolean>; t: T;
}) {
  const [name, setName] = useState(nick);
  const [where, setWhere] = useState("");
  const [sending, setSending] = useState(false);

  const send = async () => {
    if (sending) return;
    setSending(true);
    const id = cryptoRandomHex(16);
    const ts = Math.floor(Date.now() / 1000);
    const who = name || t("anon");
    await post({
      id, kind: "checkin", ts, exp: ts + 7 * 24 * 3600,
      chan: "checkin", nick: who, origin: "cloud",
      body: {
        text: `${who} ${t("safe_sentence")}${where ? ` — ${t("location_word")}: ${where}` : ""}`,
        where,
      },
    });
    setWhere("");
    setSending(false);
  };

  return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 space-y-3">
      <div>
        <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("name")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" />
      </div>
      <div>
        <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("where_are_you")}</label>
        <input value={where} onChange={(e) => setWhere(e.target.value)} maxLength={80} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder={t("where_placeholder")} />
      </div>
      <button onClick={send} disabled={sending} className="w-full rounded-lg bg-emerald-500 py-3 text-sm font-bold text-[#0a0f1e] hover:bg-emerald-400 disabled:opacity-50">
        {sending ? "…" : `✅ ${t("im_safe")}`}
      </button>
    </div>
  );
}

function MissingReport({ post, t }: {
  post: (rec: Record<string, unknown>) => Promise<boolean>; t: T;
}) {
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
    // Built from the labelled parts rather than a fixed sentence, so a report
    // with no age or no contact does not read as "name,  — . contact: ".
    const parts = [name];
    if (age) parts.push(`${t("age")}: ${age}`);
    if (desc) parts.push(desc);
    if (contact) parts.push(`${t("contact")}: ${contact}`);
    await post({
      id, kind: "missing", ts, exp: ts + 30 * 24 * 3600,
      chan: "missing", nick: name, origin: "cloud",
      body: { text: parts.join(" — "), name, age, desc, contact },
    });
    setName(""); setAge(""); setDesc(""); setContact("");
    setSending(false);
  };

  return (
    <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-3 space-y-3">
      <div>
        <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("missing_name")}</label>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500" />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-1">
          <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("age")}</label>
          <input value={age} onChange={(e) => setAge(e.target.value)} type="number" className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500" />
        </div>
        <div className="col-span-2">
          <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("contact")}</label>
          <input value={contact} onChange={(e) => setContact(e.target.value)} maxLength={60} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500" placeholder={t("contact_placeholder")} />
        </div>
      </div>
      <div>
        <label className="block text-[11px] tracking-wide text-slate-400 mb-1.5">{t("description")}</label>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} rows={2} className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm outline-none focus:border-sky-500 resize-none" placeholder={t("desc_placeholder")} />
      </div>
      <button onClick={send} disabled={sending || !name} className="w-full rounded-lg bg-sky-500 py-3 text-sm font-bold text-[#0a0f1e] hover:bg-sky-400 disabled:opacity-50">
        {sending ? "…" : `👤 ${t("report")}`}
      </button>
    </div>
  );
}

// ============================== MESH ==============================
interface MeshState {
  store?: { records?: number };
  peers?: unknown[];
  counts?: Record<string, number>;
}
interface TopoNode { node: string; name?: string; self?: boolean; records?: number }

function MeshTab({ t, n }: { t: T; n: N }) {
  const [state, setState] = useState<MeshState | null>(null);
  const [topo, setTopo] = useState<{ nodes?: TopoNode[] } | null>(null);

  // Known only on the client, and it never changes. A plain read during render
  // would disagree with the server paint; setting it from an effect would cause
  // a cascading render. This is what useSyncExternalStore is for.
  const origin = useSyncExternalStore(
    () => () => {},
    () => window.location.origin,
    () => ""
  );

  useEffect(() => {
    const poll = async () => {
      try {
        const [s, tp] = await Promise.all([
          fetch("/api/pigeonmesh/state").then((r) => r.json()),
          fetch("/api/pigeonmesh/topology").then((r) => r.json()),
        ]);
        setState(s); setTopo(tp);
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
          <Stat label={t("stat_records")} value={n(state.store?.records ?? 0)} />
          <Stat label={t("stat_peers")} value={n(state.peers?.length ?? 0)} />
          <Stat label={t("stat_sos")} value={n(state.counts?.sos ?? 0)} color="text-red-400" />
          <Stat label={t("stat_checkin")} value={n(state.counts?.checkin ?? 0)} color="text-emerald-400" />
        </div>
      )}

      {topo?.nodes && topo.nodes.length > 0 && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
          <h3 className="text-xs font-semibold text-slate-300 mb-2">🕸️ {t("topology")}</h3>
          <ul className="space-y-1.5">
            {topo.nodes.map((nd) => (
              <li key={nd.node} className="flex items-center justify-between text-xs bg-slate-950/50 rounded px-2 py-1.5">
                <div>
                  <span className="font-mono text-slate-300">{nd.node}</span>
                  {nd.self && <span className="ml-1 text-[9px] text-amber-400">({t("this_node")})</span>}
                </div>
                <div className="text-right">
                  <div className="text-slate-400">{nd.name}</div>
                  <div className="text-[9px] text-slate-600">{n(nd.records ?? 0)} {t("records_short")}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3">
        <h3 className="text-xs font-semibold text-amber-300 mb-1">🌐 {t("bridge_url")}</h3>
        <p className="font-mono text-[11px] text-amber-200 break-all">{origin}/api/pigeonmesh/sync</p>
        <p className="text-[10px] text-amber-200/60 mt-1">{t("bridge_note")}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, color = "text-slate-100" }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
      <div className="text-[10px] tracking-wide text-slate-500">{label}</div>
      <div className={`font-mono text-2xl font-bold ${color}`}>{value}</div>
    </div>
  );
}

// ============================== FOOTER ==============================
function Footer({ t }: { t: T }) {
  return (
    <footer className="border-t border-slate-800 py-3 text-center text-[10px] text-slate-600">
      PigeonMesh · GPL-2.0 · {t("memorial")}
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

function timeAgo(ts: number, t: T, n: N): string {
  const s = Math.floor(Date.now() / 1000) - ts;
  if (s < 5) return t("t_now");
  if (s < 60) return `${n(s)}${t("t_sec")}`;
  if (s < 3600) return `${n(Math.floor(s / 60))}${t("t_min")}`;
  if (s < 86400) return `${n(Math.floor(s / 3600))}${t("t_hour")}`;
  return `${n(Math.floor(s / 86400))}${t("t_day")}`;
}

function kindIcon(k: string): string {
  return ({ sos: "🚨", chat: "💬", checkin: "✅", missing: "👤", bulletin: "📢", pin: "📍", dm: "🔒", ack: "✓", profile: "👤", presence: "●" } as Record<string, string>)[k] || "📄";
}

function kindStyle(k: string): { border: string; bg: string } {
  return ({
    sos:      { border: "border-red-500/40",     bg: "bg-red-500/10" },
    chat:     { border: "border-slate-700",      bg: "bg-slate-800/30" },
    checkin:  { border: "border-emerald-500/40", bg: "bg-emerald-500/10" },
    missing:  { border: "border-sky-500/40",     bg: "bg-sky-500/10" },
    bulletin: { border: "border-amber-500/40",   bg: "bg-amber-500/10" },
    pin:      { border: "border-fuchsia-500/40", bg: "bg-fuchsia-500/10" },
    dm:       { border: "border-pink-500/40",    bg: "bg-pink-500/10" },
  } as Record<string, { border: string; bg: string }>)[k] || { border: "border-slate-700", bg: "bg-slate-800/30" };
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
