import { Router, type Request, type Response, type NextFunction } from 'express';
import crypto from 'crypto';
import { storage } from '../storage';
import type { ExternalApiKey } from '@shared/schema';

export const externalRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────

function hashKey(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// ── Auth middleware ───────────────────────────────────────────────────────

interface AuthedRequest extends Request {
  apiKey: ExternalApiKey;
}

async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization ?? '';
  const raw = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : (req.headers['x-api-key'] as string | undefined)?.trim() ?? '';

  if (!raw) {
    return res.status(401).json({ error: 'Missing API key. Pass it as Bearer token or X-Api-Key header.' });
  }

  const hash = hashKey(raw);
  const apiKey = await storage.getExternalApiKeyByHash(hash);

  if (!apiKey) {
    return res.status(401).json({ error: 'Invalid API key.' });
  }

  if (!apiKey.isActive) {
    return res.status(403).json({ error: 'API key has been revoked.' });
  }

  // Update last used timestamp (fire-and-forget)
  storage.updateExternalApiKey(apiKey.id, { lastUsedAt: new Date() }).catch(() => {});

  (req as AuthedRequest).apiKey = apiKey;
  next();
}

// ── GET /api/external/v1/markets ──────────────────────────────────────────

externalRouter.get('/v1/markets', requireApiKey, async (req: Request, res: Response) => {
  try {
    const apiKey = (req as AuthedRequest).apiKey;
    const allMarkets = await storage.getAllMarkets();

    const authorized = apiKey.allowedMarketIds && apiKey.allowedMarketIds.length > 0
      ? allMarkets.filter(m => apiKey.allowedMarketIds!.includes(m.id))
      : allMarkets;

    const visible = authorized.filter(m => m.isVisible);

    return res.json({
      markets: visible.map(m => ({
        id: m.id,
        name: m.name,
        description: m.shortDescription ?? m.description,
        category: m.category,
      })),
    });
  } catch (err: any) {
    console.error('[External API] GET /v1/markets error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── POST /api/external/v1/chat ────────────────────────────────────────────

externalRouter.post('/v1/chat', requireApiKey, async (req: Request, res: Response) => {
  try {
    const apiKey = (req as AuthedRequest).apiKey;
    const { market_id, message, session_id } = req.body as {
      market_id?: string;
      message?: string;
      session_id?: string;
    };

    if (!market_id || typeof market_id !== 'string') {
      return res.status(400).json({ error: 'market_id is required.' });
    }

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ error: 'message is required.' });
    }

    // Check market exists
    const market = await storage.getMarketById(market_id);
    if (!market) {
      return res.status(404).json({ error: `Market '${market_id}' not found.` });
    }

    // Check market authorization
    if (apiKey.allowedMarketIds && apiKey.allowedMarketIds.length > 0) {
      if (!apiKey.allowedMarketIds.includes(market_id)) {
        return res.status(403).json({ error: `Not authorized to query market '${market_id}'.` });
      }
    }

    // Resolve or create session
    const externalSessionId = session_id ?? `anon_${crypto.randomUUID()}`;
    const session = await storage.getOrCreateExternalSession(apiKey.id, externalSessionId, market_id);

    // Load conversation history
    const previousMessages = await storage.getExternalSessionMessages(session.id);
    const conversationHistory = previousMessages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    // Save user message
    await storage.addExternalMessage(session.id, 'user', message.trim());

    // Build market context and call AI
    const { buildMarketContext } = await import('../chat/context-builder');
    const { generateChatResponse } = await import('../chat/ai-service');

    const context = await buildMarketContext(market_id);
    const aiResponse = await generateChatResponse(message.trim(), context, conversationHistory);

    // Save assistant response
    await storage.addExternalMessage(session.id, 'assistant', aiResponse.content);

    return res.json({
      answer: aiResponse.content,
      session_id: externalSessionId,
      market: { id: market.id, name: market.name },
    });
  } catch (err: any) {
    console.error('[External API] POST /v1/chat error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ── GET /api/external/v1/sessions/:sessionId ──────────────────────────────

externalRouter.get('/v1/sessions/:sessionId', requireApiKey, async (req: Request, res: Response) => {
  try {
    const apiKey = (req as AuthedRequest).apiKey;
    const { sessionId } = req.params;

    const session = await storage.getExternalSession(apiKey.id, sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found.' });
    }

    const messages = await storage.getExternalSessionMessages(session.id);

    return res.json({
      session_id: sessionId,
      market_id: session.marketId,
      created_at: session.createdAt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
        created_at: m.createdAt,
      })),
    });
  } catch (err: any) {
    console.error('[External API] GET /v1/sessions error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});
