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

  const prompt = `You are an expert photography critic and coach. LensUp only analyses REAL camera-captured photographs.

STEP 1 — VERIFY: Is this a real photograph taken by a physical camera (phone, DSLR, film, etc.)?
Reject if it is: 3D render, CGI, AI-generated, digital painting, illustration, sketch, screenshot, graphic design, cartoon, or anime.

If NOT real, respond ONLY with: {"rejected": true, "reason": "<one sentence>"}

STEP 2 — If it IS a real photograph, respond ONLY with this exact JSON (no markdown):
{
  "rejected": false,
  "overall": <1-10>,
  "scores": {
    "subject_focus": <1-10>,
    "color_contrast": <1-10>,
    "composition": <1-10>,
    "lighting": <1-10>,
    "background_blur": <1-10>,
    "framing": <1-10>
  },
  "category_notes": {
    "subject_focus": "<1-2 sentences on subject sharpness and focus>",
    "color_contrast": "<1-2 sentences on color palette and contrast>",
    "composition": "<1-2 sentences on composition and visual balance>",
    "lighting": "<1-2 sentences on lighting quality and direction>",
    "background_blur": "<1-2 sentences on background separation and bokeh>",
    "framing": "<1-2 sentences on crop and framing choices>"
  },
  "summary": "<2-3 sentence overall impression>",
  "improvements": [
    {"title": "<short action title>", "desc": "<2-3 sentence detailed tip>"},
    {"title": "<short action title>", "desc": "<2-3 sentence detailed tip>"},
    {"title": "<short action title>", "desc": "<2-3 sentence detailed tip>"},
    {"title": "<short action title>", "desc": "<2-3 sentence detailed tip>"}
  ],
  "technical": "<1-2 sentences on technical quality: exposure, noise, sharpness>"
}`;

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
        max_tokens: 1500,
        messages: [{ role: 'user', content: [imageContent, { type: 'text', text: prompt }] }]
      })
    });

    const data = await claudeRes.json();
    if (!claudeRes.ok) return res.status(claudeRes.status).json({ error: data.error?.message || 'Claude API error' });

    const raw = data.content[0].text.trim().replace(/```json|```/g, '').trim();
    const result = JSON.parse(raw);
    return res.status(200).json(result);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
};
