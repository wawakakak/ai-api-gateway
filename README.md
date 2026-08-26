# AI API Gateway

A simple Node.js + Express service that exposes a chat endpoint backed by the DeepSeek API.

## Requirements

- Node.js 18 or later (uses the built-in `fetch` API)
- A DeepSeek API key

## Install

```bash
npm install
```

Copy the example env file and fill in your key:

```bash
copy .env.example .env
```

On macOS / Linux:

```bash
cp .env.example .env
```

Edit `.env` and set:

```
DEEPSEEK_API_KEY=your_key_here
```

## Run

```bash
npm start
```

The server listens on port **3000** (or `PORT` from `.env`).

## Endpoints

### `GET /`

Returns:

```
Hello World! My first AI API service is running!
```

### `POST /chat`

Send a JSON body with either a single `message` or a full `messages` array.

**Single message:**

```bash
curl -X POST http://localhost:3000/chat ^
  -H "Content-Type: application/json" ^
  -d "{\"message\": \"Hello\"}"
```

**Conversation history:**

```json
{
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" }
  ]
}
```

Successful response:

```json
{
  "reply": "Hi! How can I help you today?",
  "raw": { }
}
```

`reply` is the assistant text; `raw` is the original DeepSeek API payload.
