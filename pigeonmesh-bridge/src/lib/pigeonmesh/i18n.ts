"use client";
// Interface strings for the cloud dashboard.
//
// The dashboard used to be Bangla prose with English chrome bolted through it
// -- "সব / sos / chat / checkin" in one row of filter chips, tab labels in
// English above Bangla forms. Every visible string now comes from here, so a
// screen is one language or the other and never both.
//
// Bangla is the default for the same reason it is in the router app: the
// people this is for are not going to hunt for a language setting.
//
// No i18n library. One page, two languages, a plain object.

import { useCallback, useSyncExternalStore } from "react";

export type Lang = "bn" | "en";

const BN = {
  tagline: "যোগাযোগ যেটা শাটডাউনেও কাজ করে",
  live: "লাইভ",
  off: "বিচ্ছিন্ন",
  set_name: "নাম দিন",
  name: "নাম",
  your_name: "আপনার নাম",
  name_placeholder: "নাম লিখুন",
  anon: "অজ্ঞাত",

  tab_feed: "সব খবর",
  tab_chat: "আলাপ",
  tab_sos: "বিপদ",
  tab_people: "মানুষ",
  tab_mesh: "নেটওয়ার্ক",

  filter_all: "সব",
  kind_sos: "বিপদ",
  kind_chat: "আলাপ",
  kind_checkin: "নিরাপদ",
  kind_missing: "নিখোঁজ",
  kind_bulletin: "ঘোষণা",
  kind_pin: "জায়গা",
  kind_dm: "গোপন",
  kind_ack: "সাড়া",
  kind_profile: "পরিচয়",
  kind_presence: "উপস্থিতি",
  kind_other: "অন্য",

  count_items: "টি",
  via: "হয়ে",
  need_label: "দরকার",

  empty_feed: "এখনও কোনো খবর নেই",
  empty_feed_hint: "আলাপ পাতায় গিয়ে প্রথম বার্তা পাঠান",

  sent_ok: "পাঠানো হয়েছে",
  rejected: "বাতিল",

  channel: "চ্যানেল",
  ch_general: "সাধারণ",
  ch_relief: "ত্রাণ",
  ch_medical: "চিকিৎসা",
  ch_bulletin: "ঘোষণা",

  message: "বার্তা",
  message_placeholder: "বার্তা লিখুন…",
  sending: "পাঠানো হচ্ছে…",
  send: "পাঠান",
  recent_chat: "সাম্প্রতিক আলাপ",
  no_chat: "এখনও কোনো আলাপ নেই",

  sos_title: "জরুরি বিপদ সংকেত",
  sos_note: "যুক্ত সব ফোনে ও রাউটারে সঙ্গে সঙ্গে পৌঁছাবে",
  sos_what: "কী হয়েছে",
  sos_what_placeholder: "যেমন: ছাদে আটকে আছি, পানি বাড়ছে",
  sos_need: "কী দরকার",
  sos_send: "বিপদ সংকেত পাঠান",
  sos_default_text: "জরুরি সাহায্য দরকার",
  sos_active: "সক্রিয় বিপদ সংকেত",
  no_sos: "এখনও কোনো বিপদ সংকেত নেই",

  need_rescue: "উদ্ধার",
  need_medical: "চিকিৎসা",
  need_food: "খাবার",
  need_water: "পানি",
  need_shelter: "আশ্রয়",
  need_boat: "নৌকা",

  tab_safe: "আমি নিরাপদ",
  tab_missing: "নিখোঁজ রিপোর্ট",
  where_are_you: "আপনি কোথায়?",
  where_placeholder: "যেমন: কালীবাড়ি স্কুল আশ্রয়কেন্দ্র",
  im_safe: "আমি নিরাপদ",
  safe_sentence: "নিরাপদ আছেন",
  location_word: "অবস্থান",
  recent_safe: "নিরাপদ চেক-ইন",
  no_safe: "এখনও কেউ চেক-ইন করেননি",

  missing_name: "নিখোঁজ ব্যক্তির নাম",
  age: "বয়স",
  contact: "যোগাযোগ",
  contact_placeholder: "মোবাইল",
  description: "বর্ণনা",
  desc_placeholder: "পরিচয়, পোশাক, শেষ কোথায় দেখা গেছে…",
  report: "রিপোর্ট করুন",
  recent_missing: "নিখোঁজ ব্যক্তি",
  no_missing: "কোনো নিখোঁজ রিপোর্ট নেই",

  stat_records: "মোট রেকর্ড",
  stat_peers: "যুক্ত রাউটার",
  stat_sos: "বিপদ সংকেত",
  stat_checkin: "চেক-ইন",
  topology: "নেটওয়ার্কের চিত্র",
  this_node: "এই নোড",
  records_short: "রেকর্ড",

  bridge_url: "ব্রিজ ঠিকানা",
  bridge_note: "যেকোনো পিজনমেশ রাউটার এই ঠিকানায় সমন্বয় করতে পারে",

  memorial: "স্মারক পোর্ট ৩৬০৭",

  t_now: "এখন",
  t_sec: "সে",
  t_min: "মি",
  t_hour: "ঘ",
  t_day: "দি",
};

const EN: Record<keyof typeof BN, string> = {
  tagline: "Communication that survives a shutdown",
  live: "Live",
  off: "Offline",
  set_name: "Set your name",
  name: "Name",
  your_name: "Your name",
  name_placeholder: "Type a name",
  anon: "anon",

  tab_feed: "Feed",
  tab_chat: "Chat",
  tab_sos: "SOS",
  tab_people: "People",
  tab_mesh: "Mesh",

  filter_all: "All",
  kind_sos: "SOS",
  kind_chat: "Chat",
  kind_checkin: "Safe",
  kind_missing: "Missing",
  kind_bulletin: "Bulletin",
  kind_pin: "Place",
  kind_dm: "Private",
  kind_ack: "Reply",
  kind_profile: "Profile",
  kind_presence: "Presence",
  kind_other: "Other",

  count_items: "items",
  via: "via",
  need_label: "needs",

  empty_feed: "Nothing has come through yet",
  empty_feed_hint: "Open Chat and send the first message",

  sent_ok: "Sent",
  rejected: "Rejected",

  channel: "Channel",
  ch_general: "General",
  ch_relief: "Relief",
  ch_medical: "Medical",
  ch_bulletin: "Bulletin",

  message: "Message",
  message_placeholder: "Type a message…",
  sending: "Sending…",
  send: "Send",
  recent_chat: "Recent chat",
  no_chat: "No chat yet",

  sos_title: "Emergency alert",
  sos_note: "Reaches every connected phone and router at once",
  sos_what: "What is happening",
  sos_what_placeholder: "e.g. stuck on the roof, water rising",
  sos_need: "What do you need",
  sos_send: "Send SOS",
  sos_default_text: "Emergency help needed",
  sos_active: "Active alerts",
  no_sos: "No alerts yet",

  need_rescue: "Rescue",
  need_medical: "Medical",
  need_food: "Food",
  need_water: "Water",
  need_shelter: "Shelter",
  need_boat: "Boat",

  tab_safe: "I am safe",
  tab_missing: "Missing person",
  where_are_you: "Where are you?",
  where_placeholder: "e.g. Kalibari school shelter",
  im_safe: "I am safe",
  safe_sentence: "is safe",
  location_word: "location",
  recent_safe: "Safe check-ins",
  no_safe: "Nobody has checked in yet",

  missing_name: "Name of the missing person",
  age: "Age",
  contact: "Contact",
  contact_placeholder: "Mobile",
  description: "Description",
  desc_placeholder: "Appearance, clothing, last seen where…",
  report: "Submit report",
  recent_missing: "Missing people",
  no_missing: "No missing person reports",

  stat_records: "Records",
  stat_peers: "Linked routers",
  stat_sos: "Alerts",
  stat_checkin: "Check-ins",
  topology: "Mesh topology",
  this_node: "this node",
  records_short: "records",

  bridge_url: "Bridge address",
  bridge_note: "Any PigeonMesh router can sync to this address",

  memorial: "Memorial port 3607",

  t_now: "now",
  t_sec: "s",
  t_min: "m",
  t_hour: "h",
  t_day: "d",
};

export const DICT = { bn: BN, en: EN };
export type Key = keyof typeof BN;

export const LANG_NAME: Record<Lang, string> = { bn: "বাংলা", en: "English" };

const STORAGE_KEY = "pm-lang";

// A module-level store rather than a context provider: the dashboard is one
// page with a dozen leaf components, and threading a provider through them
// buys nothing over a subscription.
let current: Lang = "bn";
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setLang(l: Lang) {
  if (l === current) return;
  current = l;
  try {
    window.localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l;
  } catch {
    /* private mode; the choice just will not persist */
  }
  emit();
}

// Called once after mount. Reading localStorage during render would make the
// server and client disagree on the first paint.
export function initLang() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "bn" || saved === "en") setLang(saved);
    else document.documentElement.lang = current;
  } catch {
    /* nothing to restore */
  }
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const BN_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

export function useI18n() {
  const lang = useSyncExternalStore(subscribe, () => current, () => "bn" as Lang);

  const t = useCallback((k: Key) => DICT[lang][k] ?? EN[k] ?? k, [lang]);

  // Bangla numerals, because a dashboard of Western digits reads as foreign
  // to exactly the people who most need to read it quickly.
  const n = useCallback(
    (v: number | string) => {
      const s = String(v);
      return lang === "bn" ? s.replace(/[0-9]/g, (d) => BN_DIGITS[+d]) : s;
    },
    [lang]
  );

  return { lang, t, n, setLang };
}

// Record kinds arrive from the mesh as bare identifiers. Showing them raw is
// what made a Bangla page sprout English words mid-list.
export function kindKey(kind: string): Key {
  const known: Key[] = [
    "kind_sos", "kind_chat", "kind_checkin", "kind_missing", "kind_bulletin",
    "kind_pin", "kind_dm", "kind_ack", "kind_profile", "kind_presence",
  ];
  const want = `kind_${kind}` as Key;
  return known.includes(want) ? want : "kind_other";
}
