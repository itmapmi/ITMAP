import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../auth";

export function registerChatRoutes(app: Express): void {

  app.post("/api/chat/ask", requireAuth, async (req, res) => {
    const startTime = Date.now();
    let marketId: string | undefined;
    try {
      const { question, marketId: reqMarketId, conversationId } = req.body;
      marketId = reqMarketId;
      console.log(`[Chat API] Starting chat request for market: ${marketId}`);
      if (!question || typeof question !== 'string') return res.status(400).json({ error: "Question is required" });
      if (!marketId) return res.status(400).json({ error: "Market ID is required" });
      const userId = req.user!.id;
      const { generateChatResponse } = await import('../chat/ai-service');
      let conversation;
      if (conversationId) {
        console.log(`[Chat API] Using existing conversation: ${conversationId}`);
        conversation = await storage.getConversationById(conversationId);
        if (!conversation || conversation.userId !== userId) return res.status(404).json({ error: "Conversation not found" });
      } else {
        console.log(`[Chat API] Creating new conversation`);
        conversation = await storage.createConversation({ userId, marketId, title: question.substring(0, 100) });
        console.log(`[Chat API] Created conversation: ${conversation.id}`);
      }
      await storage.createMessage({ conversationId: conversation.id, role: 'user', content: question });
      console.log(`[Chat API] Saved user message`);
      const messages = await storage.getConversationMessages(conversation.id);
      const conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));
      console.log(`[Chat API] Loaded ${messages.length} previous messages`);
      console.log(`[Chat API] Building market context...`);
      const { buildMarketContext } = await import('../chat/context-builder');
      const context = await buildMarketContext(marketId);
      console.log(`[Chat API] Context built - ${context.vendors.length} vendors, ${context.features.length} features`);
      console.log(`[Chat API] Calling OpenAI...`);
      const response = await generateChatResponse(question, context, conversationHistory);
      console.log(`[Chat API] Got AI response (${response.content.length} chars)`);
      await storage.createMessage({ conversationId: conversation.id, role: 'assistant', content: response.content, sources: response.sources });
      console.log(`[Chat API] Saved assistant message`);
      await storage.updateConversation(conversation.id, {});
      const duration = Date.now() - startTime;
      console.log(`[Chat API] Request completed in ${duration}ms`);
      res.json({ conversationId: conversation.id, answer: response.content, sources: response.sources });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      console.error(`[Chat API] Error after ${duration}ms for market ${marketId}:`, error);
      console.error(`[Chat API] Error stack:`, error.stack);
      let errorMessage = "Failed to process question";
      if (error.message?.includes("timeout") || error.message?.includes("ETIMEDOUT")) {
        errorMessage = "Request timed out. Please try again.";
      } else if (error.message?.includes("rate_limit") || error.message?.includes("quota")) {
        errorMessage = "API rate limit exceeded. Please try again in a moment.";
      } else if (error.message?.includes("context") || error.message?.includes("token")) {
        errorMessage = "Unable to process this market data. Please contact support.";
      } else if (error.code === 'ECONNRESET' || error.code === 'ENOTFOUND') {
        errorMessage = "Network error. Please check your connection and try again.";
      }
      res.status(500).json({ error: errorMessage, details: process.env.NODE_ENV === 'development' ? error.message : undefined });
    }
  });

  app.get("/api/chat/conversations", requireAuth, async (req, res) => {
    try {
      const userId = req.user!.id;
      const conversations = await storage.getUserConversations(userId);
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  app.get("/api/chat/conversations/:id/messages", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const conversation = await storage.getConversationById(id);
      if (!conversation || conversation.userId !== userId) return res.status(404).json({ error: "Conversation not found" });
      const messages = await storage.getConversationMessages(id);
      res.json(messages);
    } catch (error) {
      console.error("Error fetching messages:", error);
      res.status(500).json({ error: "Failed to fetch messages" });
    }
  });

  app.delete("/api/chat/conversations/:id", requireAuth, async (req, res) => {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const conversation = await storage.getConversationById(id);
      if (!conversation || conversation.userId !== userId) return res.status(404).json({ error: "Conversation not found" });
      await storage.deleteConversation(id);
      res.json({ success: true });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });
}
