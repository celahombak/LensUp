# LensUp — Supabase Database Setup
# Run this SQL in your Supabase SQL Editor
# Dashboard → SQL Editor → New Query → paste → Run

# ── Step 1: Create the analyses table ──

CREATE TABLE analyses (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  image_url TEXT,
  overall INTEGER NOT NULL,
  composition INTEGER NOT NULL,
  lighting INTEGER NOT NULL,
  colour INTEGER NOT NULL,
  focus INTEGER NOT NULL,
  mood INTEGER NOT NULL,
  summary TEXT,
  strengths TEXT[],
  improvements TEXT[],
  technical TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

# ── Step 2: Enable Row Level Security ──

ALTER TABLE analyses ENABLE ROW LEVEL SECURITY;

# ── Step 3: Add RLS policies (users can only see/edit their own data) ──

CREATE POLICY "Users can view own analyses"
  ON analyses FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own analyses"
  ON analyses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own analyses"
  ON analyses FOR DELETE
  USING (auth.uid() = user_id);

# ── Step 4 (optional): Enable email confirmations ──
# Go to: Authentication → Settings → Email
# Turn OFF "Enable email confirmations" for easier testing
# Turn it back ON before going public
