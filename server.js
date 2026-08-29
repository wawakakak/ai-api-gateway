require("dotenv").config();

const crypto = require("crypto");
const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const QWEN_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

const VIRTUAL_KEY_PREFIX = "sk-vclient-";
const DEFAULT_BALANCE = 1_000_000;

/** @type {Map<string, {balance: number, totalUsed: number, createdAt: Date}>} */
const users = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get("/", (req, res) => {
  res.send("Hello World! My first AI API service is running!");
});

function generateVirtualKey() {
  return VIRTUAL_KEY_PREFIX + crypto.randomBytes(8).toString("hex");
}

function createUserRecord() {
  return {
    balance: DEFAULT_BALANCE,
    totalUsed: 0,
    createdAt: new Date(),
  };
}

function authenticateVirtualKey(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const match = authHeader.match(/^Bearer\s+(\S+)/i);
  const virtualKey = match ? match[1] : "";
  const user = virtualKey ? users.get(virtualKey) : undefined;

  if (!user) {
    return res.status(401).json({ error: "Invalid API Key" });
  }

  if (user.balance <= 0) {
    return res.status(402).json({ error: "Insufficient balance" });
  }

  req.user = { key: virtualKey, record: user };
  next();
}

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

app.post("/chat", authenticateVirtualKey, async (req, res) => {
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

    const totalTokens = Number(data?.usage?.total_tokens) || 0;
    const record = req.user.record;
    record.balance -= totalTokens;
    record.totalUsed += totalTokens;

    const reply = data?.choices?.[0]?.message?.content ?? "";
    return res.json({
      reply,
      model: modelName,
      provider: providerName,
      balance: record.balance,
      totalUsed: record.totalUsed,
      raw: data,
    });
  } catch (error) {
    return res.status(502).json({
      error: `Failed to call ${providerName} API`,
      details: error.message,
    });
  }
});

app.post("/admin/generate-key", (req, res) => {
  const key = generateVirtualKey();
  const record = createUserRecord();
  users.set(key, record);
  return res.json({
    key,
    balance: record.balance,
  });
});

app.get("/admin/usage", (req, res) => {
  const keys = [];
  for (const [key, record] of users.entries()) {
    keys.push({
      key,
      balance: record.balance,
      totalUsed: record.totalUsed,
      createdAt: record.createdAt,
    });
  }
  return res.json({ keys, count: keys.length });
});

app.post("/admin/add-balance", (req, res) => {
  const { key, amount } = req.body || {};

  if (typeof key !== "string" || !key.trim()) {
    return res.status(400).json({ error: 'Provide a "key" string.' });
  }

  const record = users.get(key);
  if (!record) {
    return res.status(401).json({ error: "Invalid API Key" });
  }

  const addAmount = Number(amount);
  if (!Number.isFinite(addAmount) || addAmount <= 0) {
    return res.status(400).json({ error: 'Provide a positive "amount".' });
  }

  record.balance += addAmount;
  return res.json({
    key,
    balance: record.balance,
    totalUsed: record.totalUsed,
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
