const DEFAULT_PROVIDER = (process.env.INTELLIGENCE_PROVIDER || "local").toLowerCase();
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

function localInsight(scenario, context = {}) {
  switch (scenario) {
    case "dashboard":
      return {
        confidence: 0.96,
        insight:
          "Revenue is ahead of the recent run rate, led by beer and spirits orders from Nairobi accounts. Stock pressure is concentrated in a few fast-moving SKUs, so replenishment should focus on Tusker, Whitecap, and Krest first.",
      };
    case "sales":
      return {
        confidence: 0.92,
        insight:
          "This customer usually buys mixed beer and soft drinks in higher volume. Keeping the discount near the usual floor will protect margin without affecting order completion.",
      };
    case "invoice":
      return {
        confidence: 0.94,
        insight:
          "This account has a slower settlement pattern than average. The due date is correct, but the cash is more likely to land a few days later than usual.",
      };
    case "inventory":
      return {
        confidence: 0.93,
        insight:
          "A few fast-moving lines are approaching their reorder window, while slower lines with short expiry need attention. The safest move is to replenish high-velocity SKUs first and review aging stock separately.",
      };
    case "reports":
      return {
        confidence: 0.95,
        insight:
          "Sales are being driven by beer and distributor accounts, while soft drinks remain stable. The strongest branch performance is still in Nairobi, with Mombasa showing slower recovery.",
      };
    case "procurement":
      return {
        confidence: 0.92,
        insight:
          "Supplier performance is strongest on the largest beverage lines, but a few recent purchase orders are running above the recent average. The safest move is to keep approvals tight on the higher-value items and watch delivery timing closely.",
      };
    case "customers":
      return {
        confidence: 0.91,
        insight:
          "Most active customers are buying on familiar cycles, but a small group is using more of their credit limit than usual. Prioritising follow-up with those accounts should reduce overdue balances.",
      };
    case "delivery":
      return {
        confidence: 0.9,
        insight:
          "Today’s route mix is clustered around the same delivery zones, so sequence matters more than distance. The highest-risk stops are the late afternoon ones, where delays tend to cascade.",
      };
    case "accounting":
      return {
        confidence: 0.93,
        insight:
          "Collections are improving faster than payables, but a few recent postings are outside the usual range for this account mix. Reviewing the larger ledger movements first will catch most exceptions quickly.",
      };
    case "hr":
      return {
        confidence: 0.9,
        insight:
          "Payroll is broadly in line with the last cycle, with only a few variations driven by allowances and leave. The current staffing pattern looks stable enough for the next run.",
      };
    default:
      return {
        confidence: 0.9,
        insight: "",
      };
  }
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

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
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
  });

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
    return { confidence: 0.9, insight: text || localInsight(scenario, context).insight };
  }

  if (DEFAULT_PROVIDER === "openai") {
    const text = await callOpenAI({ system, user });
    return { confidence: 0.9, insight: text || localInsight(scenario, context).insight };
  }

  return localInsight(scenario, context);
}

module.exports = {
  generateInsight,
  localInsight,
};
