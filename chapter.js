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
   'ch1-rule-of-thirds': `You are evaluating a photo specifically for the Rule of Thirds composition technique.

Analyse this photo and return ONLY valid JSON, no other text:
{
  "rejected": false,
  "composition_score": N,
  "rule_of_thirds_applied": true/false,
  "passed": true/false,
  "subject_placement": "one sentence describing where the main subject is placed",
  "horizon_placement": "one sentence about horizon line if visible, or null",
  "feedback": "2-3 sentences of specific Rule of Thirds feedback",
  "what_worked": "one sentence on what compositional element worked well",
  "improvement": "one sentence on how to better apply Rule of Thirds"
}

Rules:
- composition_score: 1-10, score ONLY on Rule of Thirds application
- passed: true if composition_score >= 7, false otherwise
- rule_of_thirds_applied: true if subject/horizon clearly uses the thirds grid
- If not a real photograph: return {"rejected": true, "reason": "brief reason"}
- Keep all text under 15 words per field`,

    'ch2-leading-lines': `You are evaluating a photo specifically for the Leading Lines composition technique.

Analyse this photo and return ONLY valid JSON, no other text:
{
  "rejected": false,
  "composition_score": N,
  "leading_lines_present": true/false,
  "passed": true/false,
  "line_type": "one sentence describing what kind of lines are present (road, fence, river, shadow, etc)",
  "line_direction": "one sentence on whether lines converge, curve, or are diagonal",
  "feedback": "2-3 sentences of specific Leading Lines feedback",
  "what_worked": "one sentence on what worked about the line usage",
  "improvement": "one sentence on how to use lines more effectively"
}

Rules:
- composition_score: 1-10, score ONLY on how effectively leading lines guide the eye to a subject or through the frame
- passed: true if composition_score >= 7, false otherwise
- leading_lines_present: true if clear directional lines exist in the frame
- A high score requires lines that clearly lead somewhere — not just lines that exist
- If not a real photograph: return {"rejected": true, "reason": "brief reason"}
- Keep all text under 15 words per field`,

    'ch3-framing': `You are evaluating a photo specifically for the Framing composition technique.

Analyse this photo and return ONLY valid JSON, no other text:
{
  "rejected": false,
  "composition_score": N,
  "frame_element_present": true/false,
  "passed": true/false,
  "frame_type": "one sentence describing what element is being used as a frame (doorway, window, arch, branches, etc)",
  "subject_isolation": "one sentence on how well the frame isolates or highlights the subject",
  "feedback": "2-3 sentences of specific Framing technique feedback",
  "what_worked": "one sentence on what worked about the framing",
  "improvement": "one sentence on how to improve the framing"
}

Rules:
- composition_score: 1-10, score ONLY on how effectively an in-scene element frames the subject
- passed: true if composition_score >= 7, false otherwise
- frame_element_present: true if a clear foreground or environmental frame element exists
- A high score requires the frame to clearly isolate, direct attention to, or add depth around a subject
- If not a real photograph: return {"rejected": true, "reason": "brief reason"}
- Keep all text under 15 words per field`
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
          model: 'claude-haiku-4-5-20251001',
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