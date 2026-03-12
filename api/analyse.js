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

  const prompt = `You are a photography critic. Analyse this image.

First check: is this a real camera photo? If not (3D render, AI art, painting, illustration, screenshot, cartoon), respond ONLY with:
{"rejected":true,"reason":"<one sentence>"}

If it IS a real photo, respond ONLY with this JSON:
{"rejected":false,"overall":<1-10>,"scores":{"subject_focus":<1-10>,"color_contrast":<1-10>,"composition":<1-10>,"lighting":<1-10>,"background_blur":<1-10>,"framing":<1-10>},"category_notes":{"subject_focus":"<1 sentence>","color_contrast":"<1 sentence>","composition":"<1 sentence>","lighting":"<1 sentence>","background_blur":"<1 sentence>","framing":"<1 sentence>"},"summary":"<2 sentences>","improvements":[{"title":"<5 words>","desc":"<1 sentence>"},{"title":"<5 words>","desc":"<1 sentence>"},{"title":"<5 words>","desc":"<1 sentence>"}],"technical":"<1 sentence>"}`;

  try {
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
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
