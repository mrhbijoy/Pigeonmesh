/* PigeonMesh -- interface strings.
 *
 * Bangla is the default. The people this is built for are not going to
 * switch a language setting while water is coming through the door.
 *
 * Two rules for anyone editing this file:
 *   - Keep strings short. They are read on a 5-inch screen, in a hurry,
 *     possibly by torchlight.
 *   - Avoid jargon in both languages. "Mesh" stays as-is because it has
 *     entered common use, but "gossip round" and "Bloom filter" never
 *     appear in the interface.
 */

const I18N = {
  bn: {
    _name: 'বাংলা',
    app_name: 'পিজনমেশ',
    tagline: 'ইন্টারনেট ছাড়াই যোগাযোগ',

    // navigation
    nav_chat: 'আলাপ',
    nav_sos: 'বিপদ',
    nav_people: 'মানুষ',
    nav_map: 'মানচিত্র',
    nav_mesh: 'নেটওয়ার্ক',

    // onboarding
    welcome_title: 'পিজনমেশে স্বাগতম',
    welcome_body: 'ইন্টারনেট বন্ধ থাকলেও এই রাউটারের সাথে যুক্ত সবাই একে অপরের সাথে কথা বলতে পারবে।',
    your_name: 'আপনার নাম',
    name_hint: 'যে নামে মানুষ আপনাকে চিনবে',
    start: 'শুরু করুন',
    identity_made: 'আপনার পরিচয় তৈরি হয়েছে',
    identity_note: 'আপনার গোপন চাবি শুধু এই ফোনেই থাকে। রাউটার তা কখনও দেখে না।',

    // connection
    connected: 'যুক্ত',
    offline: 'বিচ্ছিন্ন',
    connecting: 'সংযোগ হচ্ছে',
    carrying: 'বার্তা বহন করছে',
    node: 'নোড',

    // chat
    channel: 'চ্যানেল',
    ch_public: 'সবাই',
    ch_relief: 'ত্রাণ',
    ch_medical: 'চিকিৎসা',
    ch_sos: 'বিপদ',
    type_message: 'বার্তা লিখুন',
    send: 'পাঠান',
    no_messages: 'এখনও কোনো বার্তা নেই',
    queued: 'অপেক্ষমাণ',

    // sos
    sos_title: 'জরুরি সাহায্য',
    sos_hold: 'চেপে ধরে রাখুন',
    sos_holding: 'ছাড়বেন না…',
    sos_sent: 'বিপদ সংকেত পাঠানো হয়েছে',
    sos_what: 'কী হয়েছে?',
    sos_need: 'কী প্রয়োজন?',
    need_rescue: 'উদ্ধার',
    need_medical: 'চিকিৎসা',
    need_food: 'খাবার/পানি',
    need_shelter: 'আশ্রয়',
    need_other: 'অন্যান্য',
    sos_active: 'সক্রিয় বিপদ সংকেত',
    sos_none: 'এই মুহূর্তে কোনো বিপদ সংকেত নেই',
    respond: 'সাড়া দিচ্ছি',
    responders: 'সাড়া দিয়েছেন',
    resolve: 'সমাধান হয়েছে',
    resolved: 'সমাধান হয়েছে',
    include_location: 'অবস্থান যুক্ত করুন',

    // people
    tab_safe: 'নিরাপদ আছি',
    tab_missing: 'নিখোঁজ',
    im_safe: 'আমি নিরাপদ আছি',
    safe_note: 'আপনার পরিবার এই তালিকায় আপনাকে খুঁজে পাবে',
    where_are_you: 'আপনি কোথায় আছেন?',
    checkin_sent: 'আপনি নিরাপদ হিসেবে চিহ্নিত হয়েছেন',
    report_missing: 'নিখোঁজ ব্যক্তির তথ্য দিন',
    missing_name: 'নিখোঁজ ব্যক্তির নাম',
    missing_age: 'বয়স',
    missing_desc: 'পোশাক, চেহারা, শেষ কোথায় দেখা গেছে',
    missing_contact: 'যোগাযোগ (নাম / মোবাইল)',
    add_photo: 'ছবি যুক্ত করুন',
    submit: 'জমা দিন',
    search_name: 'নাম দিয়ে খুঁজুন',
    found: 'খুঁজে পাওয়া গেছে',
    mark_found: 'পাওয়া গেছে চিহ্নিত করুন',
    no_checkins: 'এখনও কেউ চেক-ইন করেনি',
    no_missing: 'কোনো নিখোঁজের তথ্য নেই',

    // map
    add_pin: 'জায়গা যুক্ত করুন',
    pin_shelter: 'আশ্রয়কেন্দ্র',
    pin_water: 'বিশুদ্ধ পানি',
    pin_medical: 'চিকিৎসা',
    pin_food: 'খাবার',
    pin_danger: 'বিপজ্জনক',
    pin_blocked: 'রাস্তা বন্ধ',
    pin_boat: 'নৌকা',
    pin_name: 'জায়গার নাম',
    pin_detail: 'বিস্তারিত',
    use_my_location: 'আমার অবস্থান নিন',
    tap_map: 'মানচিত্রে চাপ দিয়ে জায়গা বেছে নিন',
    no_pins: 'কোনো জায়গা যুক্ত করা হয়নি',
    locating: 'অবস্থান খোঁজা হচ্ছে…',
    no_gps: 'অবস্থান পাওয়া যায়নি',
    gps_insecure: 'এই ঠিকানায় ব্রাউজার অবস্থান দেয় না — মানচিত্রে চেপে জায়গা বেছে নিন',
    zoom_in: 'কাছে',
    zoom_out: 'দূরে',
    save_area: 'এই এলাকা সেভ',
    saving_area: 'মানচিত্র নামছে',
    area_saved: 'এলাকা সেভ হয়েছে — ইন্টারনেট ছাড়াও দেখা যাবে',
    area_failed: 'মানচিত্র নামানো যায়নি — ইন্টারনেট নেই',
    map_sketch: 'মানচিত্রের ছবি নেই — দূরত্বের ছক দেখাচ্ছে',
    map_saved_only: 'ইন্টারনেট নেই — সংরক্ষিত মানচিত্র',
    selected_spot: 'বাছাই করা জায়গা',

    // mesh
    this_node: 'এই নোড',
    nodes: 'নোডসমূহ',
    records: 'রেকর্ড',
    storage: 'সংরক্ষণ',
    uptime: 'চালু আছে',
    battery: 'ব্যাটারি',
    peers_direct: 'সরাসরি যুক্ত',
    peers_far: 'দূরের নোড',
    hops: 'হপ',
    carried_in: 'এনেছে',
    carried_out: 'দিয়েছে',
    my_identity: 'আমার পরিচয়',
    fingerprint: 'পরিচয় কোড',
    fp_note: 'সামনাসামনি দেখা হলে এই শব্দগুলো মিলিয়ে নিন',
    language: 'ভাষা',
    carry_mode: 'বার্তা বহন',
    carry_note: 'আপনি অন্য এলাকায় গেলে এই ফোন বার্তাগুলো পৌঁছে দেবে',
    panic_wipe: 'সব মুছে ফেলুন',
    panic_note: 'এই ফোন থেকে আপনার পরিচয় ও সব বার্তা মুছে যাবে। তবে অন্য নোড ও অন্য ফোনে থাকা কপি মুছবে না।',
    panic_confirm: 'নিশ্চিত? এটি ফেরানো যাবে না। মেশ থেকে বার্তা মুছবে না — শুধু এই ফোন থেকে।',
    clock_warning: 'এই নোডের ঘড়ি ঠিক নেই — সময় আনুমানিক',

    // trust
    verified: 'যাচাইকৃত',
    unverified: 'অযাচাইকৃত',
    from_node: 'নোড থেকে',
    trust_note: 'সই মিলেছে',
    untrusted_note: 'সই মেলেনি — সাবধান',

    // generic
    cancel: 'বাতিল',
    close: 'বন্ধ',
    save: 'সংরক্ষণ',
    delete: 'মুছুন',
    now: 'এইমাত্র',
    ago_m: 'মিনিট আগে',
    ago_h: 'ঘণ্টা আগে',
    ago_d: 'দিন আগে',
    install: 'অ্যাপ ইনস্টল করুন',
    optional: 'ঐচ্ছিক',
    version: 'সংস্করণ',
    unknown: 'অজানা',

    // units. Written out rather than left as KB/km, because a screen that
    // mixes two scripts mid-sentence is the thing people call unreadable.
    unit_m: 'মি',
    unit_km: 'কিমি',
    unit_kb: 'কেবি',
    unit_mb: 'এমবি',
    unit_s: 'সেকেন্ড',
  },

  en: {
    _name: 'English',
    app_name: 'PigeonMesh',
    tagline: 'Talk without the internet',

    nav_chat: 'Chat',
    nav_sos: 'SOS',
    nav_people: 'People',
    nav_map: 'Map',
    nav_mesh: 'Mesh',

    welcome_title: 'Welcome to PigeonMesh',
    welcome_body: 'Even with the internet cut, everyone connected to this router can reach each other.',
    your_name: 'Your name',
    name_hint: 'What people will know you by',
    start: 'Get started',
    identity_made: 'Your identity is ready',
    identity_note: 'Your secret key never leaves this phone. The router never sees it.',

    connected: 'Connected',
    offline: 'Offline',
    connecting: 'Connecting',
    carrying: 'Carrying messages',
    node: 'Node',

    channel: 'Channel',
    ch_public: 'Everyone',
    ch_relief: 'Relief',
    ch_medical: 'Medical',
    ch_sos: 'SOS',
    type_message: 'Type a message',
    send: 'Send',
    no_messages: 'No messages yet',
    queued: 'Queued',

    sos_title: 'Emergency',
    sos_hold: 'Hold to send',
    sos_holding: 'Keep holding…',
    sos_sent: 'SOS sent to the mesh',
    sos_what: 'What is happening?',
    sos_need: 'What do you need?',
    need_rescue: 'Rescue',
    need_medical: 'Medical',
    need_food: 'Food / water',
    need_shelter: 'Shelter',
    need_other: 'Other',
    sos_active: 'Active alerts',
    sos_none: 'No active alerts',
    respond: 'I am responding',
    responders: 'responding',
    resolve: 'Mark resolved',
    resolved: 'Resolved',
    include_location: 'Include my location',

    tab_safe: 'Safe',
    tab_missing: 'Missing',
    im_safe: 'I am safe',
    safe_note: 'Your family can find you in this list',
    where_are_you: 'Where are you?',
    checkin_sent: 'You are marked safe',
    report_missing: 'Report someone missing',
    missing_name: 'Name of the missing person',
    missing_age: 'Age',
    missing_desc: 'Clothing, appearance, last seen where',
    missing_contact: 'Contact (name / mobile)',
    add_photo: 'Add photo',
    submit: 'Submit',
    search_name: 'Search by name',
    found: 'Found',
    mark_found: 'Mark as found',
    no_checkins: 'Nobody has checked in yet',
    no_missing: 'No missing person reports',

    add_pin: 'Add a place',
    pin_shelter: 'Shelter',
    pin_water: 'Clean water',
    pin_medical: 'Medical',
    pin_food: 'Food',
    pin_danger: 'Danger',
    pin_blocked: 'Road blocked',
    pin_boat: 'Boat',
    pin_name: 'Place name',
    pin_detail: 'Details',
    use_my_location: 'Use my location',
    tap_map: 'Tap the map to place it',
    no_pins: 'No places added yet',
    locating: 'Finding your location…',
    no_gps: 'Location unavailable',
    gps_insecure: 'The browser blocks location on this address — tap the map to pick a spot',
    zoom_in: 'Closer',
    zoom_out: 'Wider',
    save_area: 'Save this area',
    saving_area: 'Downloading map',
    area_saved: 'Area saved — it will show without internet',
    area_failed: 'Could not download the map — no internet',
    map_sketch: 'No map imagery — showing a distance grid',
    map_saved_only: 'No internet — showing the saved map',
    selected_spot: 'Chosen spot',

    this_node: 'This node',
    nodes: 'Nodes',
    records: 'Records',
    storage: 'Storage',
    uptime: 'Uptime',
    battery: 'Battery',
    peers_direct: 'Directly linked',
    peers_far: 'Further away',
    hops: 'hops',
    carried_in: 'brought in',
    carried_out: 'handed over',
    my_identity: 'My identity',
    fingerprint: 'Identity code',
    fp_note: 'Read these words aloud to check you are talking to the right person',
    language: 'Language',
    carry_mode: 'Carry messages',
    carry_note: 'This phone will deliver messages when you move to another area',
    panic_wipe: 'Erase everything',
    panic_note: 'Removes your identity and all messages from this phone. Copies on other nodes and phones are not affected.',
    panic_confirm: 'Are you sure? This cannot be undone. It erases this phone only — it does not remove anything from the mesh.',
    clock_warning: 'This node has no clock — times are approximate',

    verified: 'Verified',
    unverified: 'Unverified',
    from_node: 'from node',
    trust_note: 'Signature checks out',
    untrusted_note: 'Signature does not match — be careful',

    cancel: 'Cancel',
    close: 'Close',
    save: 'Save',
    delete: 'Delete',
    now: 'just now',
    ago_m: 'min ago',
    ago_h: 'h ago',
    ago_d: 'd ago',
    install: 'Install app',
    optional: 'optional',
    version: 'Version',
    unknown: 'unknown',

    unit_m: 'm',
    unit_km: 'km',
    unit_kb: 'KB',
    unit_mb: 'MB',
    unit_s: 's',
  },
};

let LANG = localStorage.getItem('pm_lang') || 'bn';

function t(key) {
  return (I18N[LANG] && I18N[LANG][key]) || I18N.en[key] || key;
}

function setLang(l) {
  LANG = I18N[l] ? l : 'en';
  localStorage.setItem('pm_lang', LANG);
  document.documentElement.lang = LANG;
  document.dispatchEvent(new CustomEvent('pm:lang'));
}

// Bangla numerals, because a check-in list full of Western digits reads as
// foreign to exactly the people who most need to read it quickly.
const BN_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

function num(n) {
  const s = String(n);
  if (LANG !== 'bn') return s;
  return s.replace(/[0-9]/g, (d) => BN_DIGITS[+d]);
}
