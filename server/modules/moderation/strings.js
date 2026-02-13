const url = "https://api.openai.com/v1/moderations";


export const defaults = {

};

/**
 * Moderates a string for a general business/public marketplace vibe (LinkedIn/Fiverr/TaskRabbit).
 * Returns: { ok: boolean, flagged: boolean, categories, scores, reason, raw }
 */
const strings = async (input) => {
	// Basic sanity (don’t waste API calls)
	if (typeof input !== "string") {
		return { ok: false, flagged: true, reason: "Input must be a string." };
	}

	const text = input.trim();
	if (!text) {
		return { ok: true, flagged: false, reason: "Empty string." };
	}

	let resp;
	try {
		resp = await fetch(url, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
			},
			body: JSON.stringify({
				model: "omni-moderation-latest",
				input,
			}),
		});
	} catch (e) {
		return { ok: false, flagged: true, reason: `Moderation request failed: ${e.message}` };
	}

	if (!resp.ok) {
		const errText = await resp.text().catch(() => "");
		return {
			ok: false,
			flagged: true,
			reason: `Moderation HTTP ${resp.status}${errText ? `: ${errText}` : ""}`,
		};
	}

	const data = await resp.json();
	const result = data?.results?.[0];
	if (!result) {
		return { ok: false, flagged: true, reason: "Unexpected moderation response.", raw: data };
	}

	const { flagged, categories = {}, category_scores: scores = {} } = result;

	const strictThresholds = {
		"harassment/threatening": 0.20,
		"hate/threatening": 0.10,
		"self-harm/instructions": 0.10,
		"sexual/minors": 0.01,
		"illicit/violent": 0.20,
		"violence/graphic": 0.30,
	};

	// If the model already flagged it, block it.
	if (flagged) {
		return {
			ok: false,
			flagged: true,
			categories,
			scores,
			reason: "Model flagged content.",
			raw: data,
		};
	}

	// block if certain categories exceed thresholds
	for (const [cat, threshold] of Object.entries(strictThresholds)) {
		const score = typeof scores[cat] === "number" ? scores[cat] : 0;
		if (score >= threshold) {
			return {
				ok: false,
				flagged: true,
				categories,
				scores,
				reason: `Score threshold hit for ${cat} (${score.toFixed(3)} >= ${threshold}).`,
				raw: data,
			};
		}
	}

	return { ok: true, flagged: false, categories, scores, reason: "Passed.", raw: data };
};

export default () => {
	return {
		int: strings,
	};
};
