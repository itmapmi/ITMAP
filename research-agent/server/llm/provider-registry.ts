import OpenAI from "openai";

// LLM Provider interface
export interface LLMProvider {
  name: string;
  generateText(prompt: string, options?: LLMOptions): Promise<string>;
  isAvailable(): boolean;
}

export interface LLMOptions {
  maxTokens?: number;
  temperature?: number;
  model?: string;
}

// OpenAI Provider (GPT-4.1 mini)
class OpenAIProvider implements LLMProvider {
  name = "openai";
  private client: OpenAI | null = null;

  constructor() {
    const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;

    if (baseURL && apiKey) {
      this.client = new OpenAI({ baseURL, apiKey });
    }
  }

  isAvailable(): boolean {
    return this.client !== null;
  }

  async generateText(prompt: string, options: LLMOptions = {}): Promise<string> {
    if (!this.client) {
      throw new Error("OpenAI client not configured");
    }

    const response = await this.client.chat.completions.create({
      model: options.model || "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 1000,
    });

    return response.choices[0]?.message?.content || "";
  }
}

// Perplexity Provider (Sonar Deep Research)
class PerplexityProvider implements LLMProvider {
  name = "perplexity";
  private apiKey: string | null = null;

  constructor() {
    this.apiKey = process.env.PERPLEXITY_API_KEY || null;
  }

  isAvailable(): boolean {
    return this.apiKey !== null;
  }

  async generateText(prompt: string, options: LLMOptions = {}): Promise<string> {
    if (!this.apiKey) {
      throw new Error("Perplexity API key not configured");
    }

    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || "sonar-deep-research",
        messages: [{ role: "user", content: prompt }],
        temperature: options.temperature ?? 0.3,
        max_tokens: options.maxTokens ?? 2000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Perplexity API error: ${response.statusText}`);
    }

    const data = await response.json();
    return data.choices?.[0]?.message?.content || "";
  }
}

// Provider Registry
export class ProviderRegistry {
  private providers: Map<string, LLMProvider> = new Map();

  constructor() {
    this.registerProvider(new OpenAIProvider());
    this.registerProvider(new PerplexityProvider());
  }

  registerProvider(provider: LLMProvider) {
    this.providers.set(provider.name, provider);
  }

  getProvider(name: string): LLMProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new Error(`Provider ${name} not found`);
    }
    if (!provider.isAvailable()) {
      throw new Error(`Provider ${name} is not configured`);
    }
    return provider;
  }

  getAvailableProviders(): string[] {
    return Array.from(this.providers.values())
      .filter((p) => p.isAvailable())
      .map((p) => p.name);
  }
}

// Singleton instance
export const providerRegistry = new ProviderRegistry();
