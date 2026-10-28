const DEFAULT_PROVIDER = (process.env.INTELLIGENCE_PROVIDER || "local").toLowerCase();
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function localInsight(scenario, context = {}) {
  // Never manufacture company facts when no model provider is configured.
  // Deterministic operational checks are handled by their owning domain service.
  void scenario;
  void context;
  return { confidence: 0, insight: "" };
}
function extractText(response) {
  if (!response) return "";
  if (typeof response === "string") return response.trim();
  if (Array.isArray(response)) return response.map(extractText).join("\n").trim();
  if (typeof response === "object") {
    if (typeof response.text === "string") return response.text.trim();
    if (Array.isArray(response.parts)) return response.parts.map(extractText).join("\n").trim();
    if (Array.isArray(response.candidates)) {
      return response.candidates
        .map((candidate) => candidate?.content?.parts?.map((part) => part?.text || "").join(" "))
        .filter(Boolean)
        .join("\n")
        .trim();
    }
    if (Array.isArray(response.output)) return response.output.map(extractText).join("\n").trim();
  }
  return "";
}

async function callGemini({ system, user }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": key,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini request failed with ${response.status}`);
  }

  const data = await response.json();
  return extractText(data);
}

async function callOpenAI({ system, user }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      input: [
        { role: "system", content: [{ type: "text", text: system }] },
        { role: "user", content: [{ type: "text", text: user }] },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}`);
  }

  const data = await response.json();
  return extractText(data);
}

async function generateInsight({ scenario, context = {} }) {
  const systemPrompts = {
    dashboard:
      "You are a financial analyst embedded in an ERP for a Kenyan beverage distributor. Generate one short plain-English insight from the data. Be specific with numbers. No filler. No self-reference. Output plain text only.",
    sales:
      "You are a revenue planning engine. Generate one short plain-English sales guidance line from the data. Be specific and concise. Output plain text only.",
    invoice:
      "You are a billing accuracy engine. Generate one short plain-English collection-risk line from the data. Be specific and concise. Output plain text only.",
    inventory:
      "You are an inventory planning engine. Generate one short plain-English stock insight from the data. Be specific and concise. Output plain text only.",
    reports:
      "You are a financial analyst embedded in an ERP for a Kenyan beverage distributor. Generate a 2-sentence plain-English summary from the data. Be specific with numbers. No filler. No self-reference. Output plain text only.",
  };

  const system = systemPrompts[scenario] || systemPrompts.dashboard;
  const user = JSON.stringify(context);

  if (DEFAULT_PROVIDER === "gemini") {
    const text = await callGemini({ system, user });
    return text ? { confidence: 0.9, insight: text } : localInsight(scenario, context);
  }

  if (DEFAULT_PROVIDER === "openai") {
    const text = await callOpenAI({ system, user });
    return text ? { confidence: 0.9, insight: text } : localInsight(scenario, context);
  }

  return localInsight(scenario, context);
}

module.exports = {
  generateInsight,
  localInsight,
};
