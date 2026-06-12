import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";
import { recordEvent } from "./leadGen";
import { getOrBuildContext, invalidateMarket } from "../chat/context-cache";
import { generateChatStream } from "../chat/ai-service";

export { invalidateMarket };

export function registerChatRoutes(app: Express): void {

  /**
   * POST /api/chat/ask — streaming SSE endpoint.
   *
   * Writes SSE events:
   *   data: {"token":"<partial text>"}\n\n   — one per OpenAI chunk
   *   data: {"done":true,"conversationId":"<id>","sources":[...]}\n\n
   *   data: {"error":"<message>"}\n\n        — on failure
   */
  app.post("/api/chat/ask", requireAuth, async (req, res) => {
    const startTime = Date.now();
    let marketId: string | undefined;

    // ── SSE headers ──────────────────────────────────────────────────────────
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const sendEvent = (data: Record<string, unknown>) => {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      const { question, marketId: reqMarketId, conversationId } = req.body;
      marketId = reqMarketId;

      if (!question || typeof question !== "string") {
        sendEvent({ error: "Question is required" });
        return res.end();
      }
      if (!marketId) {
        sendEvent({ error: "Market ID is required" });
        return res.end();
      }

      const userId = req.user!.id;

      // ── Conversation ─────────────────────────────────────────────────────
      let conversation;
      if (conversationId) {
        conversation = await storage.getConversationById(conversationId);
        if (!conversation || conversation.userId !== userId) {
          sendEvent({ error: "Conversation not found" });
          return res.end();
        }
      } else {
        conversation = await storage.createConversation({
          userId,
          marketId,
          title: question.substring(0, 100),
        });
      }

      await storage.createMessage({ conversationId: conversation.id, role: "user", content: question });

      const dbMessages = await storage.getConversationMessages(conversation.id);
      const conversationHistory = dbMessages.map((m) => ({ role: m.role, content: m.content }));

      // ── Context (from cache, or built fresh) ─────────────────────────────
      console.log(`[Chat API] Getting context for market: ${marketId}`);
      const { context, summary } = await getOrBuildContext(marketId);
      console.log(`[Chat API] Context ready — ${context.vendors.length} vendors, ${context.features.length} features`);

      // ── Stream from OpenAI ────────────────────────────────────────────────
      let fullContent = "";
      for await (const token of generateChatStream(question, context, conversationHistory, summary)) {
        fullContent += token;
        sendEvent({ token });
      }

      // ── Build sources ─────────────────────────────────────────────────────
      const q = question.toLowerCase();
      const sources: Array<{ type: string; data: any }> = [];
      if (q.includes("vendor") || q.includes("compare") || q.includes("best"))
        sources.push({ type: "vendors", data: context.vendors.slice(0, 5) });
      if (q.includes("score") || q.includes("criteria") || q.includes("evaluation"))
        sources.push({ type: "criteria", data: context.criteria });
      if (q.includes("feature") || q.includes("capability") || q.includes("support"))
        sources.push({ type: "features", data: context.features.slice(0, 10) });
      if (q.includes("news") || q.includes("recent") || q.includes("announcement"))
        sources.push({ type: "news", data: context.news.slice(0, 10) });
      if (q.includes("quadrant") || q.includes("leader") || q.includes("position"))
        if (context.quadrantData) sources.push({ type: "quadrant", data: context.quadrantData });

      // ── Persist assistant response ─────────────────────────────────────────
      await storage.createMessage({
        conversationId: conversation.id,
        role: "assistant",
        content: fullContent,
        sources,
      });

      const duration = Date.now() - startTime;
      console.log(`[Chat API] Stream complete in ${duration}ms (${fullContent.length} chars)`);

      sendEvent({ done: true, conversationId: conversation.id, sources });

      void recordEvent(req, "chat_question_asked", {
        marketId,
        metadata: { conversationId: conversation.id, questionLength: question.length },
        durationMs: duration,
      });

      res.end();
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[Chat API] Error after ${duration}ms for market ${marketId}:`, error);
      let errorMessage = "Failed to process question. Please try again.";
      if (error.message?.includes("timeout") || error.message?.includes("ETIMEDOUT"))
        errorMessage = "Request timed out. Please try again.";
      else if (error.message?.includes("rate_limit") || error.message?.includes("quota"))
        errorMessage = "API rate limit exceeded. Please try again in a moment.";
      sendEvent({ error: errorMessage });
      res.end();
    }
  });

  // ── Conversation list ─────────────────────────────────────────────────────

  app.get("/api/chat/conversations", requireAuth, async (req, res) => {
    try {
      const conversations = await storage.getUserConversations(req.user!.id);
      res.json(conversations);
    } catch {
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/chat/conversations/:id/messages", requireAuth, async (req, res) => {
    try {
      const conversation = await storage.getConversationById(req.params.id);
      if (!conversation || conversation.userId !== req.user!.id)
        return res.status(404).json({ error: "Conversation not found" });
      res.json(await storage.getConversationMessages(req.params.id));
    } catch {
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.delete("/api/chat/conversations/:id", requireAuth, async (req, res) => {
    try {
      const conversation = await storage.getConversationById(req.params.id);
      if (!conversation || conversation.userId !== req.user!.id)
        return res.status(404).json({ error: "Conversation not found" });
      await storage.deleteConversation(req.params.id);
      res.json({ success: true });
    } catch {
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });
}
