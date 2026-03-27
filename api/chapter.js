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

  const { imageContent, chapterId, chapterName, chapterMission } = req.body || {};
  if (!imageContent)   return res.status(400).json({ error: 'No image provided' });
  if (!chapterId)      return res.status(400).json({ error: 'No chapter specified' });
  if (!chapterName)    return res.status(400).json({ error: 'No chapter name provided' });
  if (!chapterMission) return res.status(400).json({ error: 'No chapter mission provided' });

  // Auth
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: 'Not authenticated' });

  const userRes = await fetch(`${SB_URL}/auth/v1/user`, {
    headers: { 'Authorization': authHeader, 'apikey': SB_ANON_KEY }
  });
  if (!userRes.ok) return res.status(401).json({ error: 'Invalid session' });
  const userData = await userRes.json();
  const userId = userData?.id;
  if (!userId) return res.status(401).json({ error: 'Could not identify user' });

  // Check if already complete (3 submissions) — return soft response so frontend shows completion
  const progressRes = await fetch(
    `${SB_URL}/rest/v1/chapter_submissions?user_id=eq.${userId}&chapter_id=eq.${encodeURIComponent(chapterId)}&select=id`,
    { headers: { 'Authorization': authHeader, 'apikey': SB_ANON_KEY } }
  );
  const existing = await progressRes.json();
  if (Array.isArray(existing) && existing.length >= 3) {
    return res.status(200).json({
      error: 'chapter_complete',
      message: 'Chapter already complete!',
      total_submitted: existing.length,
      chapter_complete: true
    });
  }

  // Dynamic prompt works for all 36 chapters
  const prompt = `You are an expert photography coach evaluating a student photo.

Chapter: "${chapterName}"
Mission: "${chapterMission}"

Analyse this photo and return ONLY valid JSON, no markdown or backticks:
{"rejected":false,"score":N,"feedback":"2-3 sentences on how well this executes the chapter technique","what_worked":"one sentence on the strongest aspect","improvement":"one sentence on the most important thing to improve"}

Rules:
- score: 1-10, based on how well the photo demonstrates the specific chapter technique
- Be honest but encouraging — learning context
- Focus entirely on the chapter technique, not general photography
- If not a real photograph: return {"rejected":true,"reason":"brief reason"}
- Keep all text fields under 20 words`;

  try {
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
          max_tokens: 350,
          messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt }] }]
        })
      });
      data = await claudeRes.json();
      if (claudeRes.status !== 529 && claudeRes.status !== 429) break;
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!claudeRes.ok) return res.status(claudeRes.status).json({ error: data.error?.message || 'Claude API error' });

    const raw    = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);

    if (result.rejected) return res.status(200).json(result);

    // Save submission — every submission passes (3 = complete)
    await fetch(`${SB_URL}/rest/v1/chapter_submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'apikey': SB_ANON_KEY,
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        user_id:    userId,
        chapter_id: chapterId,
        score:      result.score,
        passed:     true,
        feedback:   result.feedback
      })
    });

    // Return updated count
    const checkRes = await fetch(
      `${SB_URL}/rest/v1/chapter_submissions?user_id=eq.${userId}&chapter_id=eq.${encodeURIComponent(chapterId)}&select=id`,
      { headers: { 'Authorization': authHeader, 'apikey': SB_ANON_KEY } }
    );
    const allSubs = await checkRes.json();
    result.total_submitted  = Array.isArray(allSubs) ? allSubs.length : 1;
    result.chapter_complete = result.total_submitted >= 3;

    return res.status(200).json(result);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
