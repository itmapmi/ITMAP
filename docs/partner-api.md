# ITMAP Partner API — Integration Guide

**Base URL:** `https://itmap.ai`  
**API Version:** v1  
**Authentication:** API Key (Bearer token)

---

## Overview

The ITMAP Partner API gives your agent access to ITMAP's AI-powered market intelligence engine. You can ask questions about technology vendors, market positioning, feature comparisons, competitive analysis, and more — the same intelligence available inside the ITMAP platform.

Conversations are stateful. Pass a consistent `session_id` (e.g. a Slack thread ID) and the AI will remember the full conversation history, enabling natural follow-up questions.

---

## Authentication

Every request must include your API key in one of two ways:

**Option A — Authorization header (recommended)**
```
Authorization: Bearer itmap_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

**Option B — X-Api-Key header**
```
X-Api-Key: itmap_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Your API key is scoped to one or more specific markets. Attempting to query a market outside your scope returns a `403` error.

---

## Endpoints

### 1. List Authorized Markets

Returns the list of markets your API key is authorized to query. Call this once to retrieve the `market_id` values you will use in chat requests.

```
GET /api/external/v1/markets
```

**Request**
```http
GET /api/external/v1/markets
Authorization: Bearer itmap_xxx...
```

**Response `200 OK`**
```json
{
  "markets": [
    {
      "id": "130ee3b2-16b1-4803-a8f0-8c4ed3a61d96",
      "name": "Public Cloud Object Storage",
      "description": "Analysis of enterprise object storage providers across AWS, Azure, GCP and independent vendors.",
      "category": "Infrastructure"
    }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string | Use this as `market_id` in chat requests |
| `name` | string | Human-readable market name |
| `description` | string | Short description of the market |
| `category` | string | Market category |

---

### 2. Send a Chat Message

Sends a question to the AI engine and returns an answer grounded in ITMAP's market data for that market.

```
POST /api/external/v1/chat
```

**Request headers**
```
Authorization: Bearer itmap_xxx...
Content-Type: application/json
```

**Request body**
```json
{
  "market_id": "130ee3b2-16b1-4803-a8f0-8c4ed3a61d96",
  "message": "Which vendors lead on execution and why?",
  "session_id": "C0123456789/1714000000.000100"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `market_id` | string | Yes | ID from the `/v1/markets` endpoint |
| `message` | string | Yes | The user's question |
| `session_id` | string | No | Your own session identifier. Pass the same value across turns to maintain conversation history. If omitted, a new anonymous session is created each time. |

**Response `200 OK`**
```json
{
  "answer": "Based on the ITMAP Vendor Evaluation for Public Cloud Object Storage, AWS S3 and Azure Blob Storage lead on execution...",
  "session_id": "C0123456789/1714000000.000100",
  "market": {
    "id": "130ee3b2-16b1-4803-a8f0-8c4ed3a61d96",
    "name": "Public Cloud Object Storage"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `answer` | string | The AI-generated response. May contain markdown formatting. |
| `session_id` | string | Echoes back the session ID used (useful if you omitted it and want to continue the session) |
| `market` | object | The market that was queried |

---

### 3. Retrieve Session History

Returns the full conversation history for a given session. Useful for logging or displaying previous exchanges.

```
GET /api/external/v1/sessions/:sessionId
```

**Request**
```http
GET /api/external/v1/sessions/C0123456789%2F1714000000.000100
Authorization: Bearer itmap_xxx...
```

> **Note:** URL-encode any `/` characters in the session ID — replace `/` with `%2F`.

**Response `200 OK`**
```json
{
  "session_id": "C0123456789/1714000000.000100",
  "market_id": "130ee3b2-16b1-4803-a8f0-8c4ed3a61d96",
  "created_at": "2025-04-29T08:00:00.000Z",
  "messages": [
    {
      "role": "user",
      "content": "Which vendors lead on execution and why?",
      "created_at": "2025-04-29T08:00:00.000Z"
    },
    {
      "role": "assistant",
      "content": "Based on the ITMAP Vendor Evaluation...",
      "created_at": "2025-04-29T08:00:01.000Z"
    }
  ]
}
```

---

## Error Responses

All errors follow a consistent format:

```json
{
  "error": "Description of what went wrong."
}
```

| HTTP Status | Meaning |
|---|---|
| `400` | Bad request — `market_id` or `message` is missing or invalid |
| `401` | Missing or invalid API key |
| `403` | API key is revoked, or the requested market is outside your key's scope |
| `404` | Market or session not found |
| `500` | Internal server error — contact ITMAP support |

---

## Slack Integration Pattern

If your Slack agent receives user messages and needs to call ITMAP, the recommended pattern is:

1. Use the Slack **thread timestamp** (`thread_ts`) as your `session_id` — this makes every reply in the same thread part of the same conversation
2. If no `thread_ts` exists (first message in a channel), use the message timestamp (`ts`) instead
3. POST to `/api/external/v1/chat` with that `session_id`
4. Return the `answer` field back to Slack

**Example call from your Slack agent**

```javascript
const response = await fetch('https://itmap.ai/api/external/v1/chat', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${process.env.ITMAP_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    market_id: '130ee3b2-16b1-4803-a8f0-8c4ed3a61d96',
    message: slackEvent.text,
    session_id: slackEvent.thread_ts ?? slackEvent.ts,
  }),
});

const { answer } = await response.json();

// Post answer back to Slack thread
await slackClient.chat.postMessage({
  channel: slackEvent.channel,
  thread_ts: slackEvent.thread_ts ?? slackEvent.ts,
  text: answer,
});
```

**Session behaviour**
- Same `session_id` → conversation continues with full memory of previous turns
- New `session_id` → fresh conversation, no prior context
- Sessions are stored indefinitely until explicitly not needed

---

## Example Questions the AI Can Answer

The AI is grounded in ITMAP's market data and can answer questions such as:

- *"Which vendors score highest on viability?"*
- *"Compare AWS S3 and Azure Blob Storage on multi-region support."*
- *"What recent news is there about Google Cloud Storage?"*
- *"Which vendors offer full support for immutable storage?"*
- *"Explain the methodology used in the Vendor Evaluation."*
- *"What are the top 3 vendors for a mid-market enterprise buyer?"*

---

## Support

For API key issues, scope changes, or technical questions, contact your ITMAP account administrator.
