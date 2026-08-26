require("dotenv").config();

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const QWEN_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Hello World! My first AI API service is running!");
});

function resolveChatMessages(body) {
  const { message, messages } = body;
  if (Array.isArray(messages) && messages.length > 0) {
    return messages;
  }
  if (typeof message === "string" && message.trim()) {
    return [{ role: "user", content: message }];
  }
  return null;
}

app.post("/chat", async (req, res) => {
  const body = req.body || {};
  // Read model from JSON body first; fall back to query string for clients that
  // cannot send a JSON field. Normalize so "Qwen" / " qwen " still match.
  const requestedModel = body.model ?? req.query.model;
  const modelName =
    typeof requestedModel === "string" && requestedModel.trim()
      ? requestedModel.trim().toLowerCase()
      : "deepseek";

  let apiUrl;
  let apiKey;
  let upstreamModel;
  let providerName;
  let apiKeyEnv;

  if (modelName === "qwen") {
    apiUrl = QWEN_API_URL;
    apiKeyEnv = "QWEN_API_KEY";
    apiKey = process.env.QWEN_API_KEY;
    upstreamModel = "qwen3.7-flash";
    providerName = "Qwen";
  } else if (modelName === "deepseek") {
    apiUrl = DEEPSEEK_API_URL;
    apiKeyEnv = "DEEPSEEK_API_KEY";
    apiKey = process.env.DEEPSEEK_API_KEY;
    upstreamModel = "deepseek-chat";
    providerName = "DeepSeek";
  } else {
    return res.status(400).json({
      error: `Unsupported model "${requestedModel}". Use "deepseek" or "qwen".`,
    });
  }

  if (!apiKey) {
    return res.status(500).json({
      error: `Missing ${apiKeyEnv}. Set it in your .env file.`,
    });
  }

  const chatMessages = resolveChatMessages(body);
  if (!chatMessages) {
    return res.status(400).json({
      error: 'Provide a "message" string or a "messages" array in the JSON body.',
    });
  }

  try {
    const response = await fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: upstreamModel,
        messages: chatMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: `${providerName} API request failed`,
        details: data,
      });
    }

    const reply = data?.choices?.[0]?.message?.content ?? "";
    return res.json({
      reply,
      model: modelName,
      provider: providerName,
      raw: data,
    });
  } catch (error) {
    return res.status(502).json({
      error: `Failed to call ${providerName} API`,
      details: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
