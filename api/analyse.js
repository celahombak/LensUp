module.exports = async (req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const CLAUDE_KEY   = process.env.CLAUDE_API_KEY;
  const SB_URL       = process.env.SUPABASE_URL;
  const SB_ANON_KEY  = process.env.SUPABASE_ANON_KEY;

  if (!CLAUDE_KEY) return res.status(500).json({ error: 'API key not configured' });
  if (!SB_URL || !SB_ANON_KEY) return res.status(500).json({ error: 'Supabase env vars missing' });

  const { imageContent } = req.body || {};
  if (!imageContent) return res.status(400).json({ error: 'No image provided' });

  // ── Auth: get user from token ──
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated' });

  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: {
      'Authorization': authHeader,
      'apikey': SB_ANON_KEY
    }
  });

  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const userData = await userRes.json();
  const userId = userData?.id;
  if (!userId) return res.status(401).json({ error: 'Could not identify user' });

  // ── Daily limit: check analyses table via REST ──
  const today = new Date().toISOString().split('T')[0];
  const limitRes = await fetch(
    `${SB_URL}/rest/v1/analyses?user_id=eq.${userId}&created_at=gte.${today}T00:00:00.000Z&created_at=lte.${today}T23:59:59.999Z&select=id`,
    {
      headers: {
        'Authorization': authHeader,
        'apikey': SB_ANON_KEY,
        'Content-Type': 'application/json'
      }
    }
  );

  const todayAnalyses = await limitRes.json();
  if (Array.isArray(todayAnalyses) && todayAnalyses.length >= 3) {
    return res.status(429).json({
      error: 'daily_limit',
      message: "You've used your analysis for today. Come back tomorrow! 📅"
    });
  }

  // ── Call Claude ──
  const prompt = `Rate this photo. Not a real photo? Return: {"rejected":true,"reason":"x"}
Real photo: {"rejected":false,"overall":N,"scores":{"subject_focus":N,"color_contrast":N,"composition":N,"lighting":N,"background_blur":N,"framing":N},"category_notes":{"subject_focus":"x","color_contrast":"x","composition":"x","lighting":"x","background_blur":"x","framing":"x"},"summary":"x","improvements":[{"title":"x","desc":"x"},{"title":"x","desc":"x"},{"title":"x","desc":"x"}],"technical":"x"}
N=1-10. Keep all text under 10 words.`;

  try {
    // Retry up to 2 times on rate limit
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
          max_tokens: 400,
          messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt }] }]
        })
      });
      data = await claudeRes.json();
      if (claudeRes.status !== 529 && claudeRes.status !== 429) break;
      // Wait 3s before retry
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!claudeRes.ok) return res.status(claudeRes.status).json({ error: data.error?.message || 'Claude API error' });

    const raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);

    // ── Update profile stats ──
    if (!result.rejected) {
      // Get current profile
      const profileRes = await fetch(
        `${SB_URL}/rest/v1/profiles?id=eq.${userId}&select=best_score,avg_score,total_analyses`,
        { headers: { 'Authorization': authHeader, 'apikey': SB_ANON_KEY } }
      );
      const profiles = await profileRes.json();
      const profile = profiles?.[0];

      if (profile) {
        const newTotal = (profile.total_analyses || 0) + 1;
        const newBest  = Math.max(profile.best_score || 0, result.overall);
        const newAvg   = (((profile.avg_score || 0) * (newTotal - 1)) + result.overall) / newTotal;

        await fetch(`${SB_URL}/rest/v1/profiles?id=eq.${userId}`, {
          method: 'PATCH',
          headers: {
            'Authorization': authHeader,
            'apikey': SB_ANON_KEY,
            'Content-Type': 'application/json',
            'Prefer': 'return=minimal'
          },
          body: JSON.stringify({
            best_score: newBest,
            avg_score: Math.round(newAvg * 100) / 100,
            total_analyses: newTotal,
            last_analysis_date: today,
            updated_at: new Date().toISOString()
          })
        });
      }
    }

    return res.status(200).json(result);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
