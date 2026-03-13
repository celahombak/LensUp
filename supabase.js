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

// ── Theme Helpers ──

async function getActiveTheme() {
  const { data, error } = await sb
    .from('themes')
    .select('*')
    .eq('is_active', true)
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', new Date().toISOString())
    .limit(1)
    .single();
  return error ? null : data;
}

// ── Analysis Helpers ──

async function saveAnalysis(user, url, result, thumbnail) {
  const { data, error } = await sb.from('analyses').insert({
    user_id: user.id,
    display_name: user.user_metadata?.display_name || user.email?.split('@')[0] || 'Anonymous',
    image_url: url,
    thumbnail: thumbnail || null,
    overall: result.overall,
    subject_focus: result.scores.subject_focus,
    color_contrast: result.scores.color_contrast,
    composition: result.scores.composition,
    lighting: result.scores.lighting,
    background_blur: result.scores.background_blur,
    framing: result.scores.framing,
    theme_relevance: result.scores.theme_relevance || null,
    theme_id: result.themeId || null,
    theme_name: result.themeName || null,
    category_notes: result.category_notes,
    summary: result.summary,
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
    previewUrl: row.thumbnail ? `data:image/jpeg;base64,${row.thumbnail}` : null,
    date: row.created_at,
    result: {
      overall: row.overall,
      scores: {
        subject_focus: row.subject_focus,
        color_contrast: row.color_contrast,
        composition: row.composition,
        lighting: row.lighting,
        background_blur: row.background_blur,
        framing: row.framing
      },
      category_notes: row.category_notes || {},
      summary: row.summary,
      strengths: row.strengths,
      improvements: typeof row.improvements === 'string' ? (() => { try { return JSON.parse(row.improvements); } catch { return []; } })() : (row.improvements || []),
      technical: row.technical
    }
  };
}
