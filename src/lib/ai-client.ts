import { Review } from '../types';

export async function generateAIReview(env: Env, review: Review): Promise<{ title: string; body: string; email: string }> {
	// Extract key nouns from the original review (simple approach)
	const words = (review.body || '').toLowerCase().split(/\s+/);
	const keyNouns = words
		.filter((w) => w.length > 3 && !['this', 'that', 'with', 'have', 'from', 'they', 'what', 'when'].includes(w))
		.slice(0, 5);

	const prompt = `
    You are an AI that rewrites product reviews so they sound completely different from the original.
    
    --- INPUT ---
    Original Review:
    "${review.body}"
    
    Rating: ${review.rating} stars
    Required Keywords: ${keyNouns.join(', ')}
    
    Reviewer Name:
    "${review.reviewer_name}"
    
    --- TASK ---
    Rewrite the review so it keeps the SAME meaning and sentiment, but sounds like a DIFFERENT PERSON wrote it.
    
    --- HARD RULES (STRICT) ---
    1. DO NOT copy any phrase longer than 3 consecutive words from the original
    2. DO NOT reuse sentence structure or flow
    3. CHANGE order of ideas and phrasing completely
    4. KEEP meaning and sentiment aligned with rating
    5. USE at least 2–4 required keywords naturally inside the review
    6. WRITE in a casual, human tone with slight imperfections
    7. AVOID generic, robotic, or templated wording
    8. ADD small natural variation (personal touch, opinion, or context)
    
    --- EMAIL RULES (STRICT) ---
    - Generate a realistic personal email based on the reviewer name
    - MUST look like a real human email
    - MUST NOT use placeholder or fake domains like:
      example.com, test.com, dummy.com, sample.com
    - MUST NOT include the word "example", "test", or random numbers like 12345
    - Keep it clean, simple, and believable
    - Format: lowercase, no spaces
    
    --- TITLE RULES ---
    - Short, natural, human-written
    - Not generic (avoid: "Great product", "Good quality")
    
    --- LENGTH RULE ---
    - Slightly longer than original
    - 1–3 sentences max
    
    --- SELF-CHECK (MANDATORY) ---
    Before finalizing:
    - If wording overlaps with original → REWRITE
    - If structure feels similar → REWRITE
    - If email looks fake/unrealistic → REWRITE
    
    --- OUTPUT FORMAT (STRICT JSON ONLY) ---
    {
      "email": "<realistic personal email>",
      "title": "<rewritten natural title>",
      "body": "<rewritten review>"
    }
    
    DO NOT include explanations.
    DO NOT return anything outside JSON.
  `;

	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${env.GEMINI_API_KEY}`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				contents: [{ parts: [{ text: prompt }] }],
				generationConfig: {
					temperature: 0.9, // Even more variety
					responseMimeType: 'application/json',
				},
			}),
		},
	);

	const data: any = await response.json();
	console.info('PROCESSED DATA : ', data);
	const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;

	let parsed;

	try {
		parsed = JSON.parse(text);
		if (parsed.title && parsed.body && parsed.email) {
			return { ...parsed };
		} else {
			return { title: '', body: '', email: '' };
		}
	} catch {
		throw new Error('Invalid AI response');
	}
}
