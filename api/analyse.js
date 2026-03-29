module.exports = async (req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CLAUDE_KEY  = process.env.CLAUDE_API_KEY;
  const SB_URL      = process.env.SUPABASE_URL;
  const SB_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!CLAUDE_KEY)               return res.status(500).json({ error: 'API key not configured' });
  if (!SB_URL || !SB_ANON_KEY)   return res.status(500).json({ error: 'Supabase env vars missing' });

  const { imageContent, themeId, themeName } = req.body || {};
  if (!imageContent) return res.status(400).json({ error: 'No image provided' });

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

  // ── Daily limit: 1 submission per day ──
  const today = new Date().toISOString().split('T')[0];
  const limitRes = await fetch(
    `${SB_URL}/rest/v1/analyses?user_id=eq.${userId}&source=eq.feed&created_at=gte.${today}T00:00:00.000Z&created_at=lte.${today}T23:59:59.999Z&select=id`,
    { headers: { 'Authorization': authHeader, 'apikey': SB_ANON_KEY } }
  );
  const todayAnalyses = await limitRes.json();
  if (Array.isArray(todayAnalyses) && todayAnalyses.length >= 3) {
    return res.status(429).json({
      error: 'daily_limit',
      message: "You've reached today's limit. Come back tomorrow! 📅"
    });
  }

  // ── Build prompt — inject theme if active ──
  const themeLine = themeName
    ? `This week's theme is "${themeName}". Add a theme_relevance score (1-10) for how well the photo matches the theme.`
    : '';

  const prompt = `Analyse this photo and return ONLY valid JSON, no markdown, no backticks.

If not a real photograph: {"rejected":true,"reason":"brief reason"}

If real photograph:
{
  "rejected": false,
  "overall": N,
  "scores": {"subject_focus":N,"color_contrast":N,"composition":N,"lighting":N,"background_blur":N,"framing":N${themeName ? ',"theme_relevance":N' : ''}},
  "category_notes": {"subject_focus":"one phrase","color_contrast":"one phrase","composition":"one phrase","lighting":"one phrase","background_blur":"one phrase","framing":"one phrase"${themeName ? ',"theme_relevance":"one phrase"' : ''}},
  "summary": "one sentence describing the overall photo",
  "improvements": [{"title":"short title","desc":"one actionable sentence"},{"title":"short title","desc":"one actionable sentence"},{"title":"short title","desc":"one actionable sentence"}],
  "technical": "one sentence on technical quality"
}

Rules: N=1-10. summary must be a plain sentence, not JSON. Each improvements desc must be a plain sentence. ${themeLine}`;

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
          max_tokens: 600,
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
