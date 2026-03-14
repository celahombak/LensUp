module.exports = async (req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CLAUDE_KEY  = process.env.CLAUDE_API_KEY;
  const SB_URL      = process.env.SUPABASE_URL;
  const SB_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!CLAUDE_KEY)             return res.status(500).json({ error: 'API key not configured' });
  if (!SB_URL || !SB_ANON_KEY) return res.status(500).json({ error: 'Supabase env vars missing' });

  const { imageContent, chapterId } = req.body || {};
  if (!imageContent) return res.status(400).json({ error: 'No image provided' });
  if (!chapterId)    return res.status(400).json({ error: 'No chapter specified' });

  // ── FIX: Clean the Base64 string ──
  // This removes "data:image/jpeg;base64," if it exists
  const cleanBase64 = imageContent.includes(',') ? imageContent.split(',')[1] : imageContent;

  // ── Auth ──
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated' });

  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'Authorization': authHeader, 'apikey': SB_ANON_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const userData = await userRes.json();
  const userId = userData?.id;
  if (!userId) return res.status(401).json({ error: 'Could not identify user' });

  // ── Check how many valid submissions already for this chapter ──
  const progressRes = await fetch(
    `${SB_URL}/rest/v1/chapter_submissions?user_id=eq.${userId}&chapter_id=eq.${chapterId}&passed=eq.true&select=id`,
    { headers: { 'Authorization': authHeader, 'apikey': SB_ANON_KEY } }
  );
  const passedSubs = await progressRes.json();
  if (Array.isArray(passedSubs) && passedSubs.length >= 5) {
    return res.status(400).json({ error: 'chapter_complete', message: 'You have already completed this chapter!' });
  }

  const prompt = `Rate this photo. Not a real photo? Return: {"rejected":true,"reason":"x"}
Real photo: {"rejected":false,"overall":N,"scores":{"subject_focus":N,"color_contrast":N,"composition":N,"lighting":N,"background_blur":N,"framing":N${themeName ? ',"theme_relevance":N' : ''}},"category_notes":{"subject_focus":"x","color_contrast":"x","composition":"x","lighting":"x","background_blur":"x","framing":"x"${themeName ? ',"theme_relevance":"x"' : ''}},"summary":"x","improvements":[{"title":"x","desc":"x"},{"title":"x","desc":"x"},{"title":"x","desc":"x"}],"technical":"x"}
N=1-10. Keep all text under 10 words. ${themeLine}`;

  try {
    // Retry up to 3 times on rate limit
    let claudeRes, data;
    for (let attempt = 0; attempt < 3; attempt++) {
      claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': CLAUDE_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 500,
          messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt }] }]
        })
      });
      data = await claudeRes.json();
      if (claudeRes.status !== 529 && claudeRes.status !== 429) break;
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!claudeRes.ok) return res.status(claudeRes.status).json({ error: data.error?.message || 'Claude API error' });

    const raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);

    // Attach theme info to result
    if (!result.rejected) {
      result.themeId   = themeId   || null;
      result.themeName = themeName || null;
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
