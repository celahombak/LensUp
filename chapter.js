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

  const prompts = {
    'ch1-rule-of-thirds': `You are evaluating a photo specifically for the Rule of Thirds composition technique. (Prompt truncated for brevity...)`,
    'ch2-leading-lines': `You are evaluating a photo specifically for the Leading Lines composition technique. (Prompt truncated for brevity...)`,
    'ch3-framing': `You are evaluating a photo specifically for the Framing composition technique. (Prompt truncated for brevity...)`
  };

  const prompt = prompts[chapterId];
  if (!prompt) return res.status(400).json({ error: 'Unknown chapter' });

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
          model: 'claude-3-5-sonnet-20240620', // Ensure using a vision-capable model
          max_tokens: 1024,
          messages: [{ 
            role: 'user', 
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: cleanBase64 // Using the cleaned string here
                }
              },
              { type: 'text', text: prompt } 
            ] 
          }]
        })
      });
      data = await claudeRes.json();
      if (claudeRes.status !== 529 && claudeRes.status !== 429) break;
      await new Promise(r => setTimeout(r, 3000));
    }

    if (!claudeRes.ok) return res.status(claudeRes.status).json({ error: data.error?.message || 'Claude API error' });

    const raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);

    // ... rest of your Supabase logic remains the same ...
    if (result.rejected) return res.status(200).json(result);

    const insertRes = await fetch(`${SB_URL}/rest/v1/chapter_submissions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': authHeader,
        'apikey': SB_ANON_KEY,
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({
        user_id:    userId,
        chapter_id: chapterId,
        score:      result.composition_score,
        passed:     result.passed,
        feedback:   result.feedback
      })
    });

    const insertData = await insertRes.json();
    result.submission_id = insertData?.[0]?.id || null;

    const checkRes = await fetch(
      `${SB_URL}/rest/v1/chapter_submissions?user_id=eq.${userId}&chapter_id=eq.${chapterId}&passed=eq.true&select=id`,
      { headers: { 'Authorization': authHeader, 'apikey': SB_ANON_KEY } }
    );
    const allPassed = await checkRes.json();
    result.total_passed = Array.isArray(allPassed) ? allPassed.length : 0;
    result.chapter_complete = result.total_passed >= 5;

    return res.status(200).json(result);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};