// Vercel Serverless Function — LensUp Photo Analysis

module.exports = async function handler(req, res) {

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check API key exists
  const apiKey = process.env.CLAUDE_API_KEY;
  if (!apiKey) {
    console.error('CLAUDE_API_KEY environment variable is not set');
    return res.status(500).json({ error: 'Server configuration error: API key not set. Please contact the app owner.' });
  }

  // Parse body
  let imageContent;
  try {
    imageContent = req.body?.imageContent;
  } catch (e) {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  if (!imageContent) {
    return res.status(400).json({ error: 'No image provided.' });
  }

  const prompt = `You are an expert photography critic and coach. LensUp is a photography analysis app for REAL camera-captured photographs only.

STEP 1 — CHECK IMAGE TYPE:
First, determine if this image is a real photograph taken by a camera (phone, DSLR, mirrorless, film, etc.).

Reject the image if it is any of the following:
- 3D render or CGI
- Digital painting or illustration
- AI-generated image
- Traditional painting, drawing, or sketch
- Screenshot or screen capture
- Graphic design, poster, or typography
- Cartoon or anime
- Any image not captured by a real physical camera

If the image is NOT a real photograph, respond ONLY with this exact JSON:
{
  "rejected": true,
  "reason": "<one clear sentence explaining what the image is and why it was rejected>"
}

STEP 2 — ANALYSE (only if it is a real photograph):
Respond ONLY with a valid JSON object — no markdown, no explanation outside the JSON.

{
  "rejected": false,
  "overall": <number 1-10>,
  "scores": {
    "composition": <number 1-10>,
    "lighting": <number 1-10>,
    "colour": <number 1-10>,
    "focus": <number 1-10>,
    "mood": <number 1-10>
  },
  "summary": "<2-3 sentence overall impression>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": ["<tip 1>", "<tip 2>", "<tip 3>"],
  "technical": "<1-2 sentences on technical quality>"
}`;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [imageContent, { type: 'text', text: prompt }]
          }
        ]
      })
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Claude API error:', data);
      return res.status(response.status).json({
        error: data.error?.message || 'Claude API error'
      });
    }

    const raw = data.content[0].text.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (err) {
    console.error('Function error:', err);
    return res.status(500).json({ error: 'Analysis failed: ' + err.message });
  }
}

  try {
    const { imageContent } = req.body;

    if (!imageContent) {
      return res.status(400).json({ error: 'No image provided.' });
    }

    const prompt = `You are an expert photography critic and coach. LensUp is a photography analysis app for REAL camera-captured photographs only.

STEP 1 — CHECK IMAGE TYPE:
First, determine if this image is a real photograph taken by a camera (phone, DSLR, mirrorless, film, etc.).

Reject the image if it is any of the following:
- 3D render or CGI
- Digital painting or illustration
- AI-generated image
- Traditional painting, drawing, or sketch
- Screenshot or screen capture
- Graphic design, poster, or typography
- Cartoon or anime
- Any image not captured by a real physical camera

If the image is NOT a real photograph, respond ONLY with this exact JSON:
{
  "rejected": true,
  "reason": "<one clear sentence explaining what the image is and why it was rejected>"
}

STEP 2 — ANALYSE (only if it is a real photograph):
Respond ONLY with a valid JSON object — no markdown, no explanation outside the JSON.

{
  "rejected": false,
  "overall": <number 1-10>,
  "scores": {
    "composition": <number 1-10>,
    "lighting": <number 1-10>,
    "colour": <number 1-10>,
    "focus": <number 1-10>,
    "mood": <number 1-10>
  },
  "summary": "<2-3 sentence overall impression>",
  "strengths": ["<strength 1>", "<strength 2>", "<strength 3>"],
  "improvements": ["<tip 1>", "<tip 2>", "<tip 3>"],
  "technical": "<1-2 sentences on technical quality>"
}`;

    // Call Claude API from the server (key never exposed to browser)
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: [imageContent, { type: 'text', text: prompt }]
          }
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json({ error: err.error?.message || 'Claude API error' });
    }

    const data = await response.json();
    const raw = data.content[0].text.trim();
    const clean = raw.replace(/```json|```/g, '').trim();
    const result = JSON.parse(clean);

    return res.status(200).json(result);

  } catch (err) {
    console.error('Analysis error:', err);
    return res.status(500).json({ error: 'Analysis failed: ' + err.message });
  }
}
