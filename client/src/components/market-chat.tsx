import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, queryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card } from "@/components/ui/card";
import { Loader2, Send, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: Date | string;
}

interface MarketChatProps {
  marketId: string;
}

export function MarketChat({ marketId }: MarketChatProps) {
  const [inputMessage, setInputMessage] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load conversation history on mount
  useEffect(() => {
    const loadConversations = async () => {
      try {
        const response = await fetch(`/api/markets/${marketId}/chat/conversations`);
        const conversations = await response.json();
        
        if (conversations && conversations.length > 0) {
          // Load the most recent conversation
          const latestConv = conversations[0];
          setConversationId(latestConv.id);
          
          // Load messages for this conversation
          const messagesResponse = await fetch(`/api/markets/${marketId}/chat/${latestConv.id}`);
          const messagesData = await messagesResponse.json();
          setMessages(messagesData);
        }
      } catch (error) {
        console.error("Error loading conversation history:", error);
      }
    };

    loadConversations();
  }, [marketId]);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async (message: string) => {
      const response = await apiRequest(`/api/markets/${marketId}/chat`, {
        method: "POST",
        body: JSON.stringify({
          message,
          conversationId,
        }),
      });
      return response;
    },
    onSuccess: (data) => {
      // Update conversation ID if new
      if (data.isNewConversation) {
        setConversationId(data.conversationId);
      }

      // Add messages to local state
      setMessages(prev => [
        ...prev,
        {
          id: `user-${Date.now()}`,
          role: "user",
          content: inputMessage,
          createdAt: new Date(),
        },
        {
          id: data.messageId,
          role: "assistant",
          content: data.message,
          createdAt: new Date(),
        },
      ]);

      // Clear input
      setInputMessage("");
    },
    onError: (error) => {
      console.error("Error sending message:", error);
    },
  });

  const handleSend = () => {
    if (!inputMessage.trim() || sendMessageMutation.isPending) return;
    sendMessageMutation.mutate(inputMessage);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <Card className="flex flex-col h-[600px] bg-white dark:bg-gray-900">
      {/* Header */}
      <div className="p-4 border-b bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-600" />
          <h3 className="font-semibold text-gray-900 dark:text-white">Market Analyst AI</h3>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
          Ask questions about vendors, features, scores, and news
        </p>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1 p-4" ref={scrollRef} data-testid="chat-messages">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Sparkles className="h-12 w-12 text-gray-400 mb-4" />
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
              Start a conversation
            </h4>
            <p className="text-sm text-gray-600 dark:text-gray-400 max-w-md">
              Ask me anything about this market. I can compare vendors, analyze features, explain scores, and summarize recent news.
            </p>
            <div className="mt-6 space-y-2 text-sm text-left max-w-md">
              <p className="text-gray-700 dark:text-gray-300 font-medium">Try asking:</p>
              <ul className="space-y-1 text-gray-600 dark:text-gray-400">
                <li>• "Compare the top 3 vendors"</li>
                <li>• "Which vendor has the best product capabilities?"</li>
                <li>• "What recent news affects Salesforce?"</li>
                <li>• "Show me feature support for authentication"</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                data-testid={`message-${msg.role}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    msg.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))}
            {sendMessageMutation.isPending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg px-4 py-2 border border-gray-200 dark:border-gray-700">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                </div>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Input */}
      <div className="p-4 border-t bg-gray-50 dark:bg-gray-900">
        <div className="flex gap-2">
          <Textarea
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask about vendors, features, scores, news..."
            className="flex-1 min-h-[60px] max-h-[120px] resize-none"
            disabled={sendMessageMutation.isPending}
            data-testid="input-chat-message"
          />
          <Button
            onClick={handleSend}
            disabled={!inputMessage.trim() || sendMessageMutation.isPending}
            className="self-end"
            data-testid="button-send-message"
          >
            {sendMessageMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
          Press Enter to send, Shift+Enter for new line
        </p>
      </div>
    </Card>
  );
}
