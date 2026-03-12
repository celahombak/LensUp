// ── LensUp Supabase Config ──
// This file is shared across all pages

const SUPABASE_URL = 'https://sjjgzuaeqcbtvrnmquex.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNqamd6dWFlcWNidHZybm1xdWV4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMyMDYzNjIsImV4cCI6MjA4ODc4MjM2Mn0.RRRjWxamVkzTZbEn6FwL3-6bvhFw6njXjnk9Bsu5TiI';

// ── Invite Code ──
// Change this to control who can register. Case-insensitive.
const INVITE_CODE = 'LENSUP2026';

// Initialize Supabase client (loaded via CDN on each page)
// Usage: const { data, error } = await sb.from('analyses').select()
let sb;
function initSupabase() {
  sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return sb;
}

// ── Auth Helpers ──

async function getUser() {
  const { data: { user } } = await sb.auth.getUser();
  return user;
}

async function requireAuth() {
  const user = await getUser();
  if (!user) {
    window.location.href = 'login.html';
    return null;
  }
  return user;
}

async function signOut() {
  await sb.auth.signOut();
  window.location.href = 'login.html';
}

// ── Analysis Helpers ──

async function saveAnalysis(user, url, result) {
  const { data, error } = await sb.from('analyses').insert({
    user_id: user.id,
    image_url: url,
    overall: result.overall,
    composition: result.scores.composition,
    lighting: result.scores.lighting,
    colour: result.scores.colour,
    focus: result.scores.focus,
    mood: result.scores.mood,
    summary: result.summary,
    strengths: result.strengths,
    improvements: result.improvements,
    technical: result.technical
  });
  return { data, error };
}

async function getAnalyses(user) {
  const { data, error } = await sb
    .from('analyses')
    .select('*')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false });
  return { data, error };
}

async function deleteAnalysis(id) {
  const { error } = await sb.from('analyses').delete().eq('id', id);
  return { error };
}

// ── Format helper: convert DB row → result object used by UI ──
function dbRowToResult(row) {
  return {
    id: row.id,
    url: row.image_url,
    date: row.created_at,
    result: {
      overall: row.overall,
      scores: {
        composition: row.composition,
        lighting: row.lighting,
        colour: row.colour,
        focus: row.focus,
        mood: row.mood
      },
      summary: row.summary,
      strengths: row.strengths,
      improvements: row.improvements,
      technical: row.technical
    }
  };
}
