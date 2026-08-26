require("dotenv").config();

const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;
const DEEPSEEK_API_URL = "https://api.deepseek.com/chat/completions";

app.use(express.json());

app.get("/", (req, res) => {
  res.send("Hello World! My first AI API service is running!");
});

app.post("/chat", async (req, res) => {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: "Missing DEEPSEEK_API_KEY. Set it in your .env file.",
    });
  }

  const { message, messages } = req.body || {};
  let chatMessages = messages;

  if (!Array.isArray(chatMessages) || chatMessages.length === 0) {
    if (typeof message !== "string" || !message.trim()) {
      return res.status(400).json({
        error: 'Provide a "message" string or a "messages" array in the JSON body.',
      });
    }
    chatMessages = [{ role: "user", content: message }];
  }

  try {
    const response = await fetch(DEEPSEEK_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: chatMessages,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        error: "DeepSeek API request failed",
        details: data,
      });
    }

    const reply = data?.choices?.[0]?.message?.content ?? "";
    return res.json({ reply, raw: data });
  } catch (error) {
    return res.status(502).json({
      error: "Failed to call DeepSeek API",
      details: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
