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
    - Email MUST be derived from the reviewer name only
    - MUST include at least part of the real name (first name, last name, or initials)

    - DO NOT use generic or role-based words such as:
      customer, user, admin, support, mail, contact, info, hello, test, demo

    - DO NOT invent unrelated words (no locations, no random nouns)
    - DO NOT use single-letter names like "a", "b", etc.

    - Allowed formats:
      firstname.lastname@provider
      firstnamelastname@provider
      firstinitiallastname@provider
      firstname.lastname<number>@provider (only if needed)

    - Email username MUST be at least 5 characters long
    - Keep it clean, natural, and human-like

    - Allowed providers only:
      gmail.com, yahoo.com, outlook.com, protonmail.com

    - Must be lowercase, no spaces
    
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

	const responseText = await response.text();
	const data = parseAIResponseJson(responseText);
	console.info('PROCESSED DATA : ', data ?? responseText);

	if (!response.ok) {
		throw new Error(
			`AI request failed with status ${response.status} ${response.statusText}\nAI response:\n${formatAIResponseForError(data, responseText)}`,
		);
	}

	const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
	if (!text) {
		throw new Error(`AI response did not include candidate text\nAI response:\n${formatAIResponseForError(data, responseText)}`);
	}

	let parsed;

	try {
		parsed = JSON.parse(text);
		if (parsed.title && parsed.body && parsed.email) {
			return { ...parsed };
		} else {
			throw new Error(`AI JSON is missing required fields\nParsed AI JSON:\n${JSON.stringify(parsed, null, 2)}\nAI response:\n${formatAIResponseForError(data, responseText)}`);
		}
	} catch (error) {
		if (error instanceof SyntaxError) {
			throw new Error(`Invalid AI response JSON\nCandidate text:\n${text}\nAI response:\n${formatAIResponseForError(data, responseText)}`);
		}
		throw error;
	}
}

function parseAIResponseJson(responseText: string): any | null {
	try {
		return responseText ? JSON.parse(responseText) : null;
	} catch {
		return null;
	}
}

function formatAIResponseForError(data: any | null, responseText: string): string {
	if (data) return JSON.stringify(data, null, 2);
	return responseText || '(empty response)';
}
