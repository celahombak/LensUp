module.exports = async (req, res) => {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  const { imageContent } = req.body || {};
  if (!imageContent) return res.status(400).json({ error: 'No image provided' });

  const prompt = `You are an expert photography critic and coach. LensUp is a photography analysis app for REAL camera-captured photographs only.

STEP 1 - CHECK IMAGE TYPE:
Reject if the image is a 3D render, CGI, digital painting, illustration, AI-generated image, traditional painting, drawing, sketch, screenshot, graphic design, poster, cartoon, or anime - anything not captured by a real physical camera.

If NOT a real photograph, respond ONLY with:
{"rejected": true, "reason": "<one sentence why>"}

STEP 2 - If it IS a real photograph, respond ONLY with:
{"rejected": false, "overall": <1-10>, "scores": {"composition": <1-10>, "lighting": <1-10>, "colour": <1-10>, "focus": <1-10>, "mood": <1-10>}, "summary": "<2-3 sentences>", "strengths": ["<s1>", "<s2>", "<s3>"], "improvements": ["<t1>", "<t2>", "<t3>"], "technical": "<1-2 sentences>"}`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt }] }]
      })
    });

    const data = await claudeRes.json();

    if (!claudeRes.ok) {
      return res.status(claudeRes.status).json({ error: data.error?.message || 'Claude API error' });
    }

    const raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);
    return res.status(200).json(result);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
