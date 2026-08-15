// =======================================================
// 🔌 supabaseClient.js — Connection to Supabase (Auth only)
//
// Requires the official library loaded BEFORE this file:
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="supabaseClient.js"></script>
//
// Supabase ONLY handles authentication here (email/password) and
// the `profiles` table (public username). No model, image or STL
// file goes through Supabase — see supabase_content_schema.sql for
// where that content actually lives (Postgres tables + R2 for the
// real files).
//
// ⚠️ SUPABASE_PUBLISHABLE_KEY is a "publishable" key: it is MEANT
// to be public in frontend code (like a Stripe "publishable" key).
// Real security comes from the RLS rules defined server-side, not
// from keeping this value secret. Never put a "secret" /
// "service_role" key here — that one grants full access to the
// database and must only ever exist server-side, never in code
// that runs in the browser.
// =======================================================

const SUPABASE_URL = "https://coyfyedaokkkhtmlcvaq.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_DeZEOG8W7hbVJ6KBu463QA_9w0bn-nR";

// The library exposes its own global `supabase` namespace (which
// contains createClient) — our instance is named differently so we
// don't overwrite it.
const supabaseClient = supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);
