export async function generateAIReview(
	env: Env,
	input: { title: string; body: string; rating: number },
): Promise<{ title: string; body: string }> {
	// Extract key nouns from the original review (simple approach)
	const words = (input.body || '').toLowerCase().split(/\s+/);
	const keyNouns = words
		.filter((w) => w.length > 3 && !['this', 'that', 'with', 'have', 'from', 'they', 'what', 'when'].includes(w))
		.slice(0, 5);

	const prompt = `
    You are an AI that rewrites product reviews so they sound completely different from the original.
    
    --- INPUT ---
    Original Review:
    "${input.body}"
    
    Rating: ${input.rating} stars
    Required Keywords: ${keyNouns.join(', ')}
    
    --- TASK ---
    Rewrite the review so it keeps the SAME meaning and sentiment, but sounds like a DIFFERENT PERSON wrote it.
    
    --- HARD RULES (MUST FOLLOW) ---
    1. DO NOT copy any sentence or phrase longer than 3 consecutive words
    2. DO NOT reuse the same sentence structure or order
    3. DO NOT start with similar words or phrasing
    4. CHANGE the flow of ideas (reorder, merge, or split sentences)
    5. USE the required keywords naturally
    6. KEEP the same sentiment (positive/negative tone must match rating)
    7. MAKE it sound casual, human, and slightly imperfect
    8. AVOID robotic or generic phrases
    9. ADD small personal tone variations (like opinions or context)
    
    --- LENGTH RULE ---
    - Output must be slightly longer than the original
    - Use 1–3 sentences max (natural review style)
    
    --- SELF-CHECK (CRITICAL) ---
    Before finalizing:
    - If output looks similar to original → REWRITE again
    - If sentence structure feels similar → REWRITE again
    - If wording overlaps too much → REWRITE again
    
    --- OUTPUT FORMAT (STRICT JSON) ---
    Return ONLY valid JSON:
    
    {
      "title": "<rewritten small title>",
      "body": "<rewritten review text>"
    }
    
    DO NOT return anything else.
    DO NOT include explanations.
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
		if (parsed.title && parsed.body) {
			return { ...parsed };
		} else {
			return { title: input.title, body: text.toString() };
		}
	} catch {
		throw new Error('Invalid AI response');
	}
}
