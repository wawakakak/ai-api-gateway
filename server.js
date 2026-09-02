// npm install express-session dotenv
require("dotenv").config();

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const express = require("express");
const session = require("express-session");

const app = express();
const PORT = process.env.PORT || 3000;

const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";
const QWEN_API_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DOUBAO_API_URL =
  "https://ark.cn-beijing.volces.com/api/v3/chat/completions";
const ZHIPU_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";

const VIRTUAL_KEY_PREFIX = "sk-vclient-";
const DEFAULT_BALANCE = 1_000_000;

/** @type {Map<string, {balance: number, totalUsed: number, createdAt: Date}>} */
const users = new Map();

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    secret: "ai-gateway-secret-2026",
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
  })
);

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "landing.html"));
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body || {};
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const valid =
    typeof username === "string" &&
    typeof password === "string" &&
    adminUsername &&
    adminPassword &&
    username === adminUsername &&
    password === adminPassword;

  if (!valid) {
    return res.json({ success: false, message: "用户名或密码错误" });
  }

  req.session.isAdmin = true;
  return res.json({ success: true });
});

app.post("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

const LOGOUT_SNIPPET = `
          <button
            id="logout-btn"
            type="button"
            class="rounded-lg border border-slate-700 bg-ink-800 px-4 py-2 text-sm font-medium text-slate-200 transition hover:border-rose-500 hover:text-rose-300"
          >
            退出登录
          </button>
`;

const LOGOUT_SCRIPT = `
<script>
  document.getElementById("logout-btn")?.addEventListener("click", async () => {
    await fetch("/auth/logout", { method: "POST", credentials: "same-origin" });
    window.location.href = "/";
  });
</script>
`;

app.get("/admin", (req, res) => {
  if (!req.session.isAdmin) {
    return res.sendFile(path.join(__dirname, "public", "login.html"));
  }

  const dashboardPath = path.join(__dirname, "public", "index.html");
  fs.readFile(dashboardPath, "utf8", (err, html) => {
    if (err) {
      return res.status(500).send("Failed to load dashboard");
    }
    const withLogout = html
      .replace(
        `id="generate-btn"
            type="button"
            class="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-cyan-400"
          >
            生成新 Key
          </button>`,
        `id="generate-btn"
            type="button"
            class="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-ink-950 transition hover:bg-cyan-400"
          >
            生成新 Key
          </button>
${LOGOUT_SNIPPET}`
      )
      .replace("</body>", `${LOGOUT_SCRIPT}</body>`);
    res.type("html").send(withLogout);
  });
});

app.use(express.static("public"));

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
  let modelEnv;

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
  } else if (modelName === "doubao") {
    apiUrl = DOUBAO_API_URL;
    apiKeyEnv = "DOUBAO_API_KEY";
    apiKey = process.env.DOUBAO_API_KEY;
    modelEnv = "DOUBAO_MODEL";
    upstreamModel = process.env.DOUBAO_MODEL;
    providerName = "Doubao";
  } else if (modelName === "glm") {
    apiUrl = ZHIPU_API_URL;
    apiKeyEnv = "ZHIPU_API_KEY";
    apiKey = process.env.ZHIPU_API_KEY;
    modelEnv = "ZHIPU_MODEL";
    upstreamModel = process.env.ZHIPU_MODEL;
    providerName = "Zhipu";
  } else {
    return res.status(400).json({
      error: `Unsupported model "${requestedModel}". Use "deepseek", "qwen", "doubao", or "glm".`,
    });
  }

  if (!apiKey) {
    return res.status(500).json({
      error: `Missing ${apiKeyEnv}. Set it in your .env file.`,
    });
  }

  if (modelEnv && !upstreamModel) {
    return res.status(500).json({
      error: `Missing ${modelEnv}. Set it in your .env file.`,
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
