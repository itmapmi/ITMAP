import { storage } from "../storage";
import { callOpenAI, callOpenAIDeepResearch, callPerplexity, type AIResponse } from "./ai-providers";
import { fillPromptTemplate } from "./prompt-templates";
import type { ProductEvaluationJob, ResearchPromptTemplate } from "@shared/schema";

/**
 * Extract JSON from markdown code blocks
 */
function extractJSON(text: string): string {
  const trimmed = text.trim();
  const jsonBlockMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }
  return trimmed;
}

export interface ProductEvaluationJobProgress {
  jobId: string;
  status: string;
  currentStep: string;
  completedSteps: number;
  totalSteps: number;
  totalTokensUsed: number;
  estimatedCost: number;
}

// Supported AI models
export const AI_MODELS = {
  PERPLEXITY_SONAR_PRO: "perplexity-sonar-pro",
  CHATGPT_DEEP_RESEARCH: "chatgpt-deep-research",
  CHATGPT_4O_MINI: "chatgpt-4o-mini",
  GPT_4_1_MINI: "gpt-4.1-mini",
  O4_MINI_DEEP_RESEARCH: "o4-mini-deep-research",
  O3_DEEP_RESEARCH: "o3-deep-research",
} as const;

export type AIModel = typeof AI_MODELS[keyof typeof AI_MODELS];

// Job types
export const JOB_TYPES = {
  CATEGORY_GENERATION: "category_generation",
  ANALYSIS: "analysis",
  SCORING: "scoring",
} as const;

export type JobType = typeof JOB_TYPES[keyof typeof JOB_TYPES];

/**
 * Product Evaluation Agent
 * Supports 3 independent job types: category generation, feature analysis, and feature scoring
 * Each job type can use any of the 6 supported AI models
 */
export class ProductEvaluationAgent {
  private jobId: string;
  private marketId: string;
  private vendorIds: string[];
  private featureIds?: string[];
  private jobType: JobType;
  private aiModel: AIModel;
  private promptId?: string;
  private customPrompt?: string;
  private featurePrompts?: Record<string, string>;
  
  private totalSteps: number = 0;
  private completedSteps: number = 0;
  private totalTokensUsed: number = 0;
  private totalCost: number = 0;

  constructor(
    jobId: string,
    marketId: string,
    vendorIds: string[],
    jobType: JobType,
    aiModel: AIModel,
    promptId?: string,
    featureIds?: string[],
    customPrompt?: string,
    featurePrompts?: Record<string, string>
  ) {
    this.jobId = jobId;
    this.marketId = marketId;
    this.vendorIds = vendorIds;
    this.featureIds = featureIds;
    this.jobType = jobType;
    this.aiModel = aiModel;
    this.promptId = promptId;
    this.customPrompt = customPrompt;
    this.featurePrompts = featurePrompts;
  }

  /**
   * Check if the job has been cancelled
   */
  private async checkCancellation(): Promise<void> {
    const job = await storage.getProductEvaluationJob(this.jobId);
    if (job?.status === "cancelled") {
      throw new Error("Job cancelled by user");
    }
  }

  /**
   * Call AI provider based on selected model
   */
  private async callAI(prompt: string): Promise<AIResponse> {
    console.log(`[Product Evaluation] Using AI model: ${this.aiModel}`);
    
    switch (this.aiModel) {
      case AI_MODELS.PERPLEXITY_SONAR_PRO:
        return await callPerplexity(prompt, "sonar-pro");
      
      case AI_MODELS.CHATGPT_DEEP_RESEARCH:
        // Use o1-preview for deep research
        return await callOpenAIDeepResearch(prompt, "o1-preview");
      
      case AI_MODELS.CHATGPT_4O_MINI:
        return await callOpenAI(prompt, "gpt-4o-mini");
      
      case AI_MODELS.GPT_4_1_MINI:
        return await callOpenAI(prompt, "gpt-4o"); // Full GPT-4o model
      
      case AI_MODELS.O4_MINI_DEEP_RESEARCH:
        return await callOpenAIDeepResearch(prompt, "o4-mini-deep-research-2025-06-26");
      
      case AI_MODELS.O3_DEEP_RESEARCH:
        return await callOpenAIDeepResearch(prompt, "o3-deep-research-2025-06-26");
      
      default:
        throw new Error(`Unsupported AI model: ${this.aiModel}`);
    }
  }

  /**
   * Execute the job based on job type
   */
  async execute(): Promise<void> {
    try {
      await this.updateJobStatus("running", `Starting ${this.jobType} job...`);
      
      switch (this.jobType) {
        case JOB_TYPES.CATEGORY_GENERATION:
          await this.runCategoryGeneration();
          break;
        case JOB_TYPES.ANALYSIS:
          await this.runFeatureAnalysis();
          break;
        case JOB_TYPES.SCORING:
          await this.runFeatureScoring();
          break;
        default:
          throw new Error(`Unknown job type: ${this.jobType}`);
      }

      await this.updateJobStatus("completed", `${this.jobType} completed successfully`);
    } catch (error: any) {
      if (error.message === "Job cancelled by user") {
        console.log(`[Product Evaluation] Job ${this.jobId} was cancelled by user`);
        await this.updateJobStatus("cancelled", "Job cancelled by user");
        return;
      }
      
      console.error(`[Product Evaluation] Job ${this.jobId} failed:`, error);
      await this.updateJobStatus("failed", error.message);
      throw error;
    }
  }

  /**
   * JOB TYPE 1: Generate feature categories and features
   */
  async runCategoryGeneration(): Promise<void> {
    const stepNumber = 1;
    this.totalSteps = 1;
    await this.updateJobProgress();
    
    await this.logStep(
      stepNumber,
      "category_generation",
      "running",
      undefined,
      undefined,
      undefined,
      undefined
    );
    
    try {
      // Load market
      const market = await storage.getMarketById(this.marketId);
      if (!market) throw new Error("Market not found");
      
      // Determine which prompt to use
      let prompt: string;
      if (this.customPrompt) {
        // Use custom prompt directly (with variable substitution)
        console.log(`[Product Evaluation] Using custom prompt for category generation`);
        prompt = fillPromptTemplate(this.customPrompt, {
          market_name: market.name,
          market_description: market.description || ""
        });
      } else {
        // Load prompt template or use default
        const template = await this.getPromptTemplate("category_generation");
        prompt = fillPromptTemplate(template.promptTemplate, {
          market_name: market.name,
          market_description: market.description || ""
        });
      }
      
      // Call AI
      const response = await this.callAI(prompt);
      
      // Track costs
      this.totalTokensUsed += response.tokensUsed;
      this.totalCost += response.estimatedCost;
      
      // Parse response
      const jsonContent = extractJSON(response.content);
      const data = JSON.parse(jsonContent);
      
      // Validate structure
      if (!data.categories || !Array.isArray(data.categories)) {
        throw new Error("Invalid response: missing categories array");
      }
      
      // Create or update feature categories and features (idempotent)
      const existingCategories = await storage.getFeatureCategoriesByMarketId(this.marketId);
      
      for (const categoryData of data.categories) {
        // Check if category already exists by name
        let category = existingCategories.find(c => c.name === categoryData.name);
        
        if (category) {
          // Update existing category
          console.log(`[Product Evaluation] Updating existing category: ${categoryData.name}`);
          category = await storage.updateFeatureCategory(category.id, {
            description: categoryData.description || null,
            displayOrder: categoryData.displayOrder || 0,
          });
        } else {
          // Create new category
          console.log(`[Product Evaluation] Creating new category: ${categoryData.name}`);
          category = await storage.createFeatureCategory({
            marketId: this.marketId,
            name: categoryData.name,
            description: categoryData.description || null,
            displayOrder: categoryData.displayOrder || 0,
          });
        }
        
        // Create or update features for this category
        if (categoryData.features && Array.isArray(categoryData.features)) {
          const existingFeatures = await storage.getFeaturesByCategoryId(category.id);
          
          for (const featureData of categoryData.features) {
            // Check if feature already exists by name
            const existingFeature = existingFeatures.find(f => f.name === featureData.name);
            
            if (existingFeature) {
              // Update existing feature
              console.log(`[Product Evaluation] Updating existing feature: ${featureData.name}`);
              await storage.updateFeature(existingFeature.id, {
                description: featureData.description || null,
                defaultPrompt: featureData.evaluationPrompt || null,
                displayOrder: featureData.displayOrder || 0,
              });
            } else {
              // Create new feature
              console.log(`[Product Evaluation] Creating new feature: ${featureData.name}`);
              await storage.createFeature({
                categoryId: category.id,
                name: featureData.name,
                description: featureData.description || null,
                defaultPrompt: featureData.evaluationPrompt || null,
                displayOrder: featureData.displayOrder || 0,
              });
            }
          }
        }
      }
      
      console.log(`[Product Evaluation] Generated ${data.categories.length} feature categories`);
      
      await this.logStep(
        stepNumber,
        "category_generation",
        "completed",
        undefined,
        undefined,
        this.getAIProvider(),
        this.getModelName(),
        prompt,
        response.content,
        response.tokensUsed,
        response.estimatedCost
      );
      
      this.completedSteps = 1;
      await this.updateJobProgress();
      
    } catch (error: any) {
      await this.logStep(
        stepNumber,
        "category_generation",
        "failed",
        undefined,
        undefined,
        this.getAIProvider(),
        this.getModelName(),
        undefined,
        undefined,
        undefined,
        undefined,
        error.message
      );
      throw error;
    }
  }

  /**
   * JOB TYPE 2: Generate analysis/commentary for each vendor-feature combination
   */
  async runFeatureAnalysis(): Promise<void> {
    // Load market and vendors
    const market = await storage.getMarketById(this.marketId);
    if (!market) throw new Error("Market not found");
    
    const vendors = await Promise.all(
      this.vendorIds.map(id => storage.getVendorById(id))
    );
    
    const validVendors = vendors.filter(v => v !== null);
    if (validVendors.length === 0) {
      throw new Error("No valid vendors found");
    }
    
    // Get all features for this market
    const allCategories = await storage.getFeatureCategoriesByMarketId(this.marketId);
    let allFeatures: any[] = [];
    for (const category of allCategories) {
      const features = await storage.getFeaturesByCategoryId(category.id);
      allFeatures.push(...features);
    }
    
    // Filter features if specific features are selected
    if (this.featureIds && this.featureIds.length > 0) {
      allFeatures = allFeatures.filter(f => this.featureIds!.includes(f.id));
      if (allFeatures.length === 0) {
        throw new Error("None of the selected features were found for this market.");
      }
      console.log(`[Product Evaluation] Processing ${allFeatures.length} selected features (out of ${this.featureIds.length} requested)`);
    }
    
    if (allFeatures.length === 0) {
      throw new Error("No features found for this market. Please create categories/features first (manually or via Category Generation).");
    }
    
    console.log(`[Product Evaluation] Generating commentary for ${validVendors.length} vendors × ${allFeatures.length} features`);
    
    // Calculate total steps
    this.totalSteps = validVendors.length * allFeatures.length;
    await this.updateJobProgress();
    
    // Load prompt template
    const template = await this.getPromptTemplate("commentary");
    
    // Generate commentary for each vendor × feature
    for (const vendor of validVendors) {
      for (const feature of allFeatures) {
        await this.checkCancellation();
        await this.generateFeatureCommentary(vendor, feature, market, template);
      }
    }
  }

  /**
   * Generate commentary for a specific vendor-feature combination
   */
  private async generateFeatureCommentary(
    vendor: any,
    feature: any,
    market: any,
    template: any
  ): Promise<void> {
    const stepNumber = ++this.completedSteps;
    
    await this.logStep(
      stepNumber,
      "commentary",
      "running",
      vendor.id,
      feature.id,
      undefined,
      undefined
    );
    
    try {
      // Determine which prompt to use (priority order)
      let promptTemplate: string;
      if (this.featurePrompts && this.featurePrompts[feature.id]) {
        // 1. Use user-provided custom prompt
        console.log(`[Product Evaluation] Using custom prompt for feature: ${feature.name}`);
        promptTemplate = this.featurePrompts[feature.id];
      } else if (feature.defaultPrompt) {
        // 2. Use AI-generated default prompt from category generation
        console.log(`[Product Evaluation] Using AI-generated default prompt for feature: ${feature.name}`);
        promptTemplate = feature.defaultPrompt;
      } else {
        // 3. Fallback to template-based prompt
        promptTemplate = template.promptTemplate;
      }
      
      const prompt = fillPromptTemplate(promptTemplate, {
        market_name: market.name,
        vendor_name: vendor.name,
        vendor_product: vendor.product || vendor.name,
        feature_name: feature.name,
        feature_description: feature.description || ""
      });
      
      // Call AI
      const response = await this.callAI(prompt);
      
      // Track costs
      this.totalTokensUsed += response.tokensUsed;
      this.totalCost += response.estimatedCost;
      
      // Store or update commentary (idempotent)
      await storage.createOrUpdateVendorFeatureSupport({
        vendorId: vendor.id,
        featureId: feature.id,
        supportLevel: 0, // Default, will be scored in next job type
        comments: response.content,
      });
      
      await this.logStep(
        stepNumber,
        "commentary",
        "completed",
        vendor.id,
        feature.id,
        this.getAIProvider(),
        this.getModelName(),
        prompt,
        response.content,
        response.tokensUsed,
        response.estimatedCost
      );
      
      await this.updateJobProgress();
      
    } catch (error: any) {
      await this.logStep(
        stepNumber,
        "commentary",
        "failed",
        vendor.id,
        feature.id,
        this.getAIProvider(),
        this.getModelName(),
        undefined,
        undefined,
        undefined,
        undefined,
        error.message
      );
      throw error;
    }
  }

  /**
   * JOB TYPE 3: Score each vendor-feature combination based on commentary
   */
  async runFeatureScoring(): Promise<void> {
    // Load market and vendors
    const market = await storage.getMarketById(this.marketId);
    if (!market) throw new Error("Market not found");
    
    const vendors = await Promise.all(
      this.vendorIds.map(id => storage.getVendorById(id))
    );
    
    const validVendors = vendors.filter(v => v !== null);
    if (validVendors.length === 0) {
      throw new Error("No valid vendors found");
    }
    
    // Get all features for this market
    const allCategories = await storage.getFeatureCategoriesByMarketId(this.marketId);
    let allFeatures: any[] = [];
    for (const category of allCategories) {
      const features = await storage.getFeaturesByCategoryId(category.id);
      allFeatures.push(...features);
    }
    
    // Filter features if specific features are selected
    if (this.featureIds && this.featureIds.length > 0) {
      allFeatures = allFeatures.filter(f => this.featureIds!.includes(f.id));
      if (allFeatures.length === 0) {
        throw new Error("None of the selected features were found for this market.");
      }
      console.log(`[Product Evaluation] Processing ${allFeatures.length} selected features (out of ${this.featureIds.length} requested)`);
    }
    
    if (allFeatures.length === 0) {
      throw new Error("No features found for this market. Please create categories/features first (manually or via Category Generation).");
    }
    
    console.log(`[Product Evaluation] Scoring ${validVendors.length} vendors × ${allFeatures.length} features`);
    
    // Calculate total steps
    this.totalSteps = validVendors.length * allFeatures.length;
    await this.updateJobProgress();
    
    // Load prompt template
    const template = await this.getPromptTemplate("scoring");
    
    // Score each vendor × feature
    for (const vendor of validVendors) {
      for (const feature of allFeatures) {
        await this.checkCancellation();
        await this.scoreFeatureCommentary(vendor, feature, market, template);
      }
    }
  }

  /**
   * Score a specific vendor-feature combination
   */
  private async scoreFeatureCommentary(
    vendor: any,
    feature: any,
    market: any,
    template: any
  ): Promise<void> {
    const stepNumber = ++this.completedSteps;
    
    await this.logStep(
      stepNumber,
      "scoring",
      "running",
      vendor.id,
      feature.id,
      undefined,
      undefined
    );
    
    try {
      // Get existing commentary
      const existing = await storage.getVendorFeature(vendor.id, feature.id);
      
      if (!existing || !existing.comments) {
        throw new Error(`No commentary found for ${vendor.name} - ${feature.name}. Please run feature analysis first.`);
      }
      
      // Determine which prompt to use (priority order)
      let promptTemplate: string;
      if (this.featurePrompts && this.featurePrompts[feature.id]) {
        // 1. Use user-provided custom prompt
        console.log(`[Product Evaluation] Using custom scoring prompt for feature: ${feature.name}`);
        promptTemplate = this.featurePrompts[feature.id];
      } else if (feature.defaultPrompt) {
        // 2. Use AI-generated default prompt from category generation
        console.log(`[Product Evaluation] Using AI-generated default scoring prompt for feature: ${feature.name}`);
        promptTemplate = feature.defaultPrompt;
      } else {
        // 3. Fallback to template-based prompt
        promptTemplate = template.promptTemplate;
      }
      
      const prompt = fillPromptTemplate(promptTemplate, {
        market_name: market.name,
        vendor_name: vendor.name,
        vendor_product: vendor.product || vendor.name,
        feature_name: feature.name,
        feature_description: feature.description || "",
        commentary: existing.comments
      });
      
      // Call AI
      const response = await this.callAI(prompt);
      
      // Track costs
      this.totalTokensUsed += response.tokensUsed;
      this.totalCost += response.estimatedCost;
      
      // Parse score (0-4)
      const score = this.parseHarveyBallScore(response.content);
      
      // Update support level (idempotent)
      await storage.createOrUpdateVendorFeatureSupport({
        vendorId: vendor.id,
        featureId: feature.id,
        supportLevel: score,
        comments: existing.comments, // Preserve existing commentary
      });
      
      await this.logStep(
        stepNumber,
        "scoring",
        "completed",
        vendor.id,
        feature.id,
        this.getAIProvider(),
        this.getModelName(),
        prompt,
        response.content,
        response.tokensUsed,
        response.estimatedCost
      );
      
      await this.updateJobProgress();
      
    } catch (error: any) {
      await this.logStep(
        stepNumber,
        "scoring",
        "failed",
        vendor.id,
        feature.id,
        this.getAIProvider(),
        this.getModelName(),
        undefined,
        undefined,
        undefined,
        undefined,
        error.message
      );
      throw error;
    }
  }

  /**
   * Parse Harvey Ball score from AI response (0-4 scale)
   */
  private parseHarveyBallScore(content: string): number {
    // Try to extract number from response
    const match = content.match(/\b([0-4])\b/);
    if (match) {
      return parseInt(match[1], 10);
    }
    
    // Look for keywords
    const lower = content.toLowerCase();
    if (lower.includes("full support") || lower.includes("fully supported")) return 4;
    if (lower.includes("good support") || lower.includes("well supported")) return 3;
    if (lower.includes("partial") || lower.includes("moderate")) return 2;
    if (lower.includes("limited") || lower.includes("minimal")) return 1;
    if (lower.includes("not supported") || lower.includes("no support")) return 0;
    
    // Default to 2 if unclear
    console.warn(`[Product Evaluation] Could not parse Harvey Ball score from: ${content.substring(0, 100)}`);
    return 2;
  }

  /**
   * Get AI provider name based on selected model
   */
  private getAIProvider(): string {
    if (this.aiModel === AI_MODELS.PERPLEXITY_SONAR_PRO) {
      return "perplexity";
    } else if (
      this.aiModel === AI_MODELS.CHATGPT_DEEP_RESEARCH ||
      this.aiModel === AI_MODELS.O4_MINI_DEEP_RESEARCH ||
      this.aiModel === AI_MODELS.O3_DEEP_RESEARCH
    ) {
      return "openai-deep-research";
    } else {
      return "openai";
    }
  }

  /**
   * Get model name for logging
   */
  private getModelName(): string {
    switch (this.aiModel) {
      case AI_MODELS.PERPLEXITY_SONAR_PRO:
        return "sonar-pro";
      case AI_MODELS.CHATGPT_DEEP_RESEARCH:
        return "o1-preview";
      case AI_MODELS.CHATGPT_4O_MINI:
        return "gpt-4o-mini";
      case AI_MODELS.GPT_4_1_MINI:
        return "gpt-4o";
      case AI_MODELS.O4_MINI_DEEP_RESEARCH:
        return "o4-mini-deep-research-2025-06-26";
      case AI_MODELS.O3_DEEP_RESEARCH:
        return "o3-deep-research-2025-06-26";
      default:
        return this.aiModel;
    }
  }

  /**
   * Get prompt template based on job type
   */
  private async getPromptTemplate(stepType: string): Promise<any> {
    if (this.promptId) {
      const template = await storage.getResearchPromptTemplate(this.promptId);
      if (template) return template;
    }
    
    // Return default template
    return {
      promptTemplate: this.getDefaultPrompt(stepType),
      aiProvider: this.getAIProvider(),
      model: this.getModelName(),
    };
  }

  /**
   * Get default prompts for each job type
   */
  private getDefaultPrompt(stepType: string): string {
    switch (stepType) {
      case "category_generation":
        return `You are a product analyst creating a comprehensive feature evaluation framework for the ${"{market_name}"} market.

Generate a structured list of feature categories and individual features that should be evaluated when comparing vendors in this market.

Market Description: ${"{market_description}"}

For each feature, also provide an "evaluationPrompt" - a detailed prompt that explains how to evaluate vendors for that specific feature. This prompt will be used by AI to analyze vendor capabilities and should guide the analysis to look for specific capabilities, implementation approaches, or technical details.

Return your response as JSON in this exact format:
{
  "categories": [
    {
      "name": "Category Name",
      "description": "Category description",
      "displayOrder": 0,
      "features": [
        {
          "name": "Feature Name",
          "description": "Feature description",
          "evaluationPrompt": "Detailed prompt explaining how to evaluate {vendor_name}'s {feature_name} capability. Focus on [specific aspects to evaluate]. Variables available: {vendor_name}, {vendor_product}, {market_name}, {feature_name}, {feature_description}",
          "displayOrder": 0
        }
      ]
    }
  ]
}

Focus on creating 5-8 meaningful categories with 3-6 features each. Make the features specific and measurable. The evaluationPrompt should be detailed and actionable, guiding the AI to look for specific implementation details, capabilities, or technical aspects.`;

      case "commentary":
        return `You are a product analyst evaluating how well ${"{vendor_product}"} (by ${"{vendor_name}"}) supports the feature "${"{feature_name}"}" in the ${"{market_name}"} market.

Feature Description: ${"{feature_description}"}

Provide a detailed analysis of:
1. Whether this vendor supports this feature
2. How well they implement it
3. Any limitations or gaps
4. Specific capabilities related to this feature

Be specific and factual. If you don't have information, clearly state that.`;

      case "scoring":
        return `Based on the following commentary about ${"{vendor_product}"} (by ${"{vendor_name}"}) and their support for "${"{feature_name}"}":

${"{commentary}"}

Assign a Harvey Ball score (0-4):
- 0 = Not Supported (0%)
- 1 = Limited Support (25%)
- 2 = Partial Support (50%)
- 3 = Good Support (75%)
- 4 = Full Support (100%)

Return ONLY a single number (0, 1, 2, 3, or 4) followed by a brief one-line justification.`;

      default:
        throw new Error(`Unknown step type: ${stepType}`);
    }
  }

  /**
   * Update job status
   */
  private async updateJobStatus(status: string, currentStep: string): Promise<void> {
    await storage.updateProductEvaluationJob(this.jobId, {
      status,
      currentStep,
      totalCost: this.totalCost.toString(),
      totalTokensUsed: this.totalTokensUsed,
      ...(status === "running" ? { startedAt: new Date() } : {}),
      ...(status === "completed" || status === "failed" || status === "cancelled" ? { completedAt: new Date() } : {}),
    });
  }

  /**
   * Update job progress
   */
  private async updateJobProgress(): Promise<void> {
    await storage.updateProductEvaluationJob(this.jobId, {
      totalSteps: this.totalSteps,
      completedSteps: this.completedSteps,
      totalCost: this.totalCost.toString(),
      totalTokensUsed: this.totalTokensUsed,
    });
  }

  /**
   * Log a step
   */
  private async logStep(
    stepNumber: number,
    stepType: string,
    status: string,
    vendorId?: string,
    featureId?: string,
    aiProvider?: string,
    model?: string,
    promptUsed?: string,
    responseContent?: string,
    tokensUsed?: number,
    estimatedCost?: number,
    errorMessage?: string
  ): Promise<void> {
    await storage.createProductEvaluationJobLog({
      jobId: this.jobId,
      stepNumber,
      stepType,
      status,
      vendorId: vendorId || null,
      featureId: featureId || null,
      aiProvider: aiProvider || null,
      model: model || null,
      promptUsed: promptUsed || null,
      responseContent: responseContent || null,
      tokensUsed: tokensUsed || null,
      estimatedCost: estimatedCost ? estimatedCost.toString() : null,
      errorMessage: errorMessage || null,
      ...(status === "running" ? { startedAt: new Date() } : {}),
      ...(status === "completed" || status === "failed" ? { completedAt: new Date() } : {}),
    });
  }
}
