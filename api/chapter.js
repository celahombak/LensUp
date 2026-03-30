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

  const { imageContent, chapterId, chapterName, chapterMission, thumbnail } = req.body || {};
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
  const prompt = `You are an expert photography coach giving feedback to a student learning ${chapterName}.

Chapter technique: "${chapterName}"
Student mission: "${chapterMission}"

Look carefully at this photo and return ONLY valid JSON, no markdown, no backticks, no preamble.

Required JSON format:
{"rejected":false,"score":N,"feedback":"string","what_worked":"string","improvement":"string"}

Scoring (score: 1-10):
- 9-10: Technique executed masterfully and intentionally
- 7-8: Technique clearly present, minor refinements possible
- 5-6: Technique attempted, execution inconsistent or weak
- 3-4: Technique barely visible, fundamental misunderstanding
- 1-2: Technique absent entirely

Feedback rules — THIS IS CRITICAL:
- "feedback": 2 sentences. Sentence 1: describe SPECIFICALLY what you see in the photo relating to the technique (mention actual visual elements — where the subject sits, the direction of light, the actual lines visible, the actual colours present). Sentence 2: explain the direct effect this has on the viewer or the image.
- "what_worked": 1 sentence. Name the single most successful specific element. Be concrete — not "good composition" but "the tree trunk enters from the bottom-left and pulls the eye directly to the subject at the upper-right intersection point".
- "improvement": 1 sentence. Give ONE specific, actionable instruction the student can try on their NEXT shot. Start with a verb. Be precise — not "improve your lighting" but "position yourself so the light source is 45 degrees to your left, creating shadow on one side of the subject's face".

Tone: direct coach, not cheerleader. Honest about what needs work. Specific over vague always.

If the image is not a real photograph (illustration, screenshot, text, AI art): return {"rejected":true,"reason":"one sentence explanation"}`;

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
          max_tokens: 600,
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
        feedback:   result.feedback,
        thumbnail:  thumbnail || null
      })
    });

    // Return updated count
    const checkRes = await fetch(
      `${SB_URL}/rest/v1/chapter_submissions?user_id=eq.${userId}&chapter_id=eq.${encodeURIComponent(chapterId)}&select=id,score,thumbnail&order=created_at.asc`,
      { headers: { 'Authorization': authHeader, 'apikey': SB_ANON_KEY } }
    );
    const allSubs = await checkRes.json();
    result.total_submitted  = Array.isArray(allSubs) ? allSubs.length : 1;
    result.chapter_complete = result.total_submitted >= 3;
    result.submissions      = Array.isArray(allSubs) ? allSubs : [];

    return res.status(200).json(result);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
