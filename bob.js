// BOB's AI: a small server function on Vercel. It keeps your Claude API key secret
// and lets Claude search the web for current prices.
// Settings (Vercel > Project > Settings > Environment Variables):
//   ANTHROPIC_API_KEY  your key from console.anthropic.com (required)
//   APP_CODE           an access code you choose, so strangers can't spend your credit (recommended)
//   CLAUDE_MODEL       model id from docs.claude.com (optional)
//   MAX_SEARCHES       web searches per answer, default 3 (optional)
module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return res.status(500).json({ error: "no_key" });
  if (process.env.APP_CODE && req.headers["x-bob-code"] !== process.env.APP_CODE) return res.status(401).json({ error: "not_granted" });

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const raw = Array.isArray(body.messages) ? body.messages : [];
  // Claude expects alternating turns that start with "user": merge neighbours with the same role.
  const messages = [];
  for (const m of raw) {
    const role = m && m.role === "assistant" ? "assistant" : "user";
    const content = String((m && m.content) || "").slice(0, 60000);
    if (!content) continue;
    if (messages.length && messages[messages.length - 1].role === role) messages[messages.length - 1].content += "\n\n" + content;
    else messages.push({ role, content });
  }
  if (!messages.length || messages[0].role !== "user") return res.status(400).json({ error: "bad_request" });

  const request = {
    model: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
    max_tokens: 8000,
    messages,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: Number(process.env.MAX_SEARCHES || 3) }]
  };
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(request)
    });
    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: (data.error && data.error.type) || "upstream_error", message: data.error && data.error.message });
    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    return res.status(200).json({ text, truncated: data.stop_reason === "max_tokens" });
  } catch (e) {
    return res.status(502).json({ error: "upstream_error", message: String(e && e.message || e) });
  }
};
