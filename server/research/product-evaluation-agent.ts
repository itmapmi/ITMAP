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

/**
 * Product Evaluation Agent
 * Automates feature category generation, commentary, and scoring for vendor products
 */
export class ProductEvaluationAgent {
  private jobId: string;
  private marketId: string;
  private vendorIds: string[];
  private categoryPromptId?: string;
  private commentaryPromptId?: string;
  private scoringPromptId?: string;
  
  private totalSteps: number = 0;
  private completedSteps: number = 0;
  private totalTokensUsed: number = 0;
  private totalCost: number = 0;

  constructor(
    jobId: string,
    marketId: string,
    vendorIds: string[],
    categoryPromptId?: string,
    commentaryPromptId?: string,
    scoringPromptId?: string
  ) {
    this.jobId = jobId;
    this.marketId = marketId;
    this.vendorIds = vendorIds;
    this.categoryPromptId = categoryPromptId;
    this.commentaryPromptId = commentaryPromptId;
    this.scoringPromptId = scoringPromptId;
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
   * Execute the full product evaluation workflow
   */
  async execute(): Promise<void> {
    try {
      await this.updateJobStatus("running", "Initializing product evaluation agent...");
      
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

      console.log(`[Product Evaluation] Processing ${validVendors.length} vendors for market ${market.name}`);
      
      // Step 1: Generate feature categories and features
      await this.checkCancellation();
      await this.generateFeatureCategories(market);
      
      // Get all features for this market
      const allCategories = await storage.getFeatureCategoriesByMarketId(this.marketId);
      const allFeatures: any[] = [];
      for (const category of allCategories) {
        const features = await storage.getFeaturesByCategoryId(category.id);
        allFeatures.push(...features);
      }
      
      console.log(`[Product Evaluation] Found ${allFeatures.length} features across ${allCategories.length} categories`);
      
      // Calculate total steps: category generation + (vendors × features × 2) for commentary and scoring
      this.totalSteps = 1 + (validVendors.length * allFeatures.length * 2);
      await this.updateJobProgress();
      
      // Step 2: Generate commentary for each vendor × feature
      for (const vendor of validVendors) {
        for (const feature of allFeatures) {
          await this.checkCancellation();
          await this.generateFeatureCommentary(vendor, feature);
        }
      }
      
      // Step 3: Score each vendor × feature
      for (const vendor of validVendors) {
        for (const feature of allFeatures) {
          await this.checkCancellation();
          await this.scoreFeatureCommentary(vendor, feature);
        }
      }

      await this.updateJobStatus("completed", "Product evaluation completed successfully");
    } catch (error: any) {
      // Check if it was a cancellation
      if (error.message === "Job cancelled by user") {
        console.log(`[Product Evaluation] Job ${this.jobId} was cancelled by user`);
        await this.updateJobStatus("cancelled", "Job cancelled by user");
        return;
      }
      
      // Handle other errors
      console.error(`[Product Evaluation] Job ${this.jobId} failed:`, error);
      await this.updateJobStatus("failed", error.message);
      throw error;
    }
  }

  /**
   * Generate feature categories and features using AI
   */
  private async generateFeatureCategories(market: any): Promise<void> {
    const stepNumber = ++this.completedSteps;
    
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
      // Load prompt template
      const template = await this.getPromptTemplate("category_generation");
      
      const prompt = fillPromptTemplate(template.promptTemplate, {
        market_name: market.name,
        market_description: market.description || ""
      });
      
      // Call AI based on provider
      let response: AIResponse;
      if (template.aiProvider === "perplexity") {
        console.log(`[Product Evaluation] Using Perplexity ${template.model} for category generation`);
        response = await callPerplexity(prompt, template.model);
      } else if (template.aiProvider === "openai-deep-research") {
        console.log(`[Product Evaluation] Using OpenAI Deep Research ${template.model} for category generation`);
        response = await callOpenAIDeepResearch(prompt, template.model);
      } else {
        // Default to OpenAI standard models
        console.log(`[Product Evaluation] Using OpenAI ${template.model} for category generation`);
        response = await callOpenAI(prompt, template.model);
      }
      
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
      
      // Create feature categories and features
      for (const categoryData of data.categories) {
        const category = await storage.createFeatureCategory({
          marketId: this.marketId,
          name: categoryData.name,
          description: categoryData.description || null,
          displayOrder: categoryData.displayOrder || 0,
        });
        
        // Create features for this category
        if (categoryData.features && Array.isArray(categoryData.features)) {
          for (const featureData of categoryData.features) {
            await storage.createFeature({
              categoryId: category.id,
              name: featureData.name,
              description: featureData.description || null,
              displayOrder: featureData.displayOrder || 0,
            });
          }
        }
      }
      
      console.log(`[Product Evaluation] Generated ${data.categories.length} feature categories`);
      
      await this.logStep(
        stepNumber,
        "category_generation",
        "completed",
        template.aiProvider,
        template.model,
        response.tokensUsed,
        response.estimatedCost,
        undefined,
        response.content
      );
      
      await this.updateJobProgress();
    } catch (error: any) {
      await this.logStep(stepNumber, "category_generation", "failed", undefined, undefined, 0, 0, error.message);
      throw error;
    }
  }

  /**
   * Generate commentary for a specific vendor-feature combination
   */
  private async generateFeatureCommentary(vendor: any, feature: any): Promise<void> {
    const stepNumber = ++this.completedSteps;
    
    await this.logStep(
      stepNumber,
      "commentary",
      "running",
      undefined,
      vendor.id,
      feature.id
    );
    
    try {
      // Load prompt template
      const template = await this.getPromptTemplate("commentary");
      
      const prompt = fillPromptTemplate(template.promptTemplate, {
        vendor_name: vendor.name,
        feature_name: feature.name,
        feature_description: feature.description || ""
      });
      
      // Call AI based on provider
      let response: AIResponse;
      if (template.aiProvider === "perplexity") {
        console.log(`[Product Evaluation] Using Perplexity for commentary: ${vendor.name} - ${feature.name}`);
        response = await callPerplexity(prompt, template.model);
      } else if (template.aiProvider === "openai-deep-research") {
        console.log(`[Product Evaluation] Using OpenAI Deep Research for commentary: ${vendor.name} - ${feature.name}`);
        response = await callOpenAIDeepResearch(prompt, template.model);
      } else {
        console.log(`[Product Evaluation] Using OpenAI for commentary: ${vendor.name} - ${feature.name}`);
        response = await callOpenAI(prompt, template.model);
      }
      
      // Track costs
      this.totalTokensUsed += response.tokensUsed;
      this.totalCost += response.estimatedCost;
      
      // Update vendor feature with commentary
      const existingFeature = await storage.getVendorFeature(vendor.id, feature.id);
      if (existingFeature) {
        await storage.updateVendorFeature({
          vendorId: vendor.id,
          featureId: feature.id,
          commentary: response.content,
        });
      } else {
        await storage.createVendorFeature({
          vendorId: vendor.id,
          featureId: feature.id,
          supportLevel: 0, // Will be scored in next step
          commentary: response.content,
        });
      }
      
      await this.logStep(
        stepNumber,
        "commentary",
        "completed",
        template.aiProvider,
        template.model,
        response.tokensUsed,
        response.estimatedCost,
        undefined,
        response.content
      );
      
      await this.updateJobProgress();
    } catch (error: any) {
      await this.logStep(stepNumber, "commentary", "failed", undefined, undefined, 0, 0, error.message);
      console.error(`[Product Evaluation] Commentary generation failed for ${vendor.name} - ${feature.name}:`, error);
    }
  }

  /**
   * Score a vendor-feature combination based on commentary
   */
  private async scoreFeatureCommentary(vendor: any, feature: any): Promise<void> {
    const stepNumber = ++this.completedSteps;
    
    await this.logStep(
      stepNumber,
      "scoring",
      "running",
      undefined,
      vendor.id,
      feature.id
    );
    
    try {
      // Get existing commentary
      const vendorFeature = await storage.getVendorFeature(vendor.id, feature.id);
      if (!vendorFeature || !vendorFeature.commentary) {
        throw new Error("No commentary found for scoring");
      }
      
      // Load prompt template
      const template = await this.getPromptTemplate("scoring");
      
      const prompt = fillPromptTemplate(template.promptTemplate, {
        vendor_name: vendor.name,
        feature_name: feature.name,
        commentary: vendorFeature.commentary
      });
      
      // Call AI based on provider
      let response: AIResponse;
      if (template.aiProvider === "perplexity") {
        console.log(`[Product Evaluation] Using Perplexity for scoring: ${vendor.name} - ${feature.name}`);
        response = await callPerplexity(prompt, template.model);
      } else if (template.aiProvider === "openai-deep-research") {
        console.log(`[Product Evaluation] Using OpenAI Deep Research for scoring: ${vendor.name} - ${feature.name}`);
        response = await callOpenAIDeepResearch(prompt, template.model);
      } else {
        console.log(`[Product Evaluation] Using OpenAI for scoring: ${vendor.name} - ${feature.name}`);
        response = await callOpenAI(prompt, template.model);
      }
      
      // Track costs
      this.totalTokensUsed += response.tokensUsed;
      this.totalCost += response.estimatedCost;
      
      // Parse score (0-4)
      const jsonContent = extractJSON(response.content);
      const data = JSON.parse(jsonContent);
      
      if (typeof data.score !== "number" || data.score < 0 || data.score > 4) {
        throw new Error(`Invalid score: ${data.score}. Must be 0-4.`);
      }
      
      // Update vendor feature with score
      await storage.updateVendorFeature({
        vendorId: vendor.id,
        featureId: feature.id,
        supportLevel: data.score,
      });
      
      console.log(`[Product Evaluation] Scored ${vendor.name} - ${feature.name}: ${data.score}/4`);
      
      await this.logStep(
        stepNumber,
        "scoring",
        "completed",
        template.aiProvider,
        template.model,
        response.tokensUsed,
        response.estimatedCost,
        undefined,
        response.content
      );
      
      await this.updateJobProgress();
    } catch (error: any) {
      await this.logStep(stepNumber, "scoring", "failed", undefined, undefined, 0, 0, error.message);
      console.error(`[Product Evaluation] Scoring failed for ${vendor.name} - ${feature.name}:`, error);
    }
  }

  /**
   * Get prompt template or use default
   */
  private async getPromptTemplate(type: "category_generation" | "commentary" | "scoring"): Promise<ResearchPromptTemplate> {
    // Map type to promptId
    let promptId: string | undefined;
    if (type === "category_generation") promptId = this.categoryPromptId;
    else if (type === "commentary") promptId = this.commentaryPromptId;
    else if (type === "scoring") promptId = this.scoringPromptId;
    
    if (promptId) {
      const template = await storage.getResearchPromptTemplate(promptId);
      if (template) return template;
    }
    
    // Return default templates
    return this.getDefaultPromptTemplate(type);
  }

  /**
   * Get default prompt templates
   */
  private getDefaultPromptTemplate(type: "category_generation" | "commentary" | "scoring"): ResearchPromptTemplate {
    const defaults: Record<string, ResearchPromptTemplate> = {
      category_generation: {
        id: "default-category",
        name: "Default Feature Category Generation",
        description: "Generate feature categories and features for product evaluation",
        category: "category_generation",
        aiProvider: "openai",
        model: "gpt-4o",
        promptTemplate: `You are a technology market analyst. Generate a comprehensive list of feature categories and features for the {{market_name}} market.

Market Description: {{market_description}}

Return a JSON object with this structure:
{
  "categories": [
    {
      "name": "Category Name",
      "description": "Category description",
      "displayOrder": 1,
      "features": [
        {
          "name": "Feature Name",
          "description": "Feature description",
          "displayOrder": 1
        }
      ]
    }
  ]
}

Include 5-8 categories with 3-6 features each. Focus on the most important product capabilities and ecosystem integrations.`,
        variables: ["market_name", "market_description"],
        criteriaId: null,
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      
      commentary: {
        id: "default-commentary",
        name: "Default Feature Commentary",
        description: "Generate detailed commentary for vendor feature support",
        category: "commentary",
        aiProvider: "openai",
        model: "gpt-4o",
        promptTemplate: `Analyze {{vendor_name}}'s support for the following feature:

Feature: {{feature_name}}
Description: {{feature_description}}

Provide a detailed analysis of how well this vendor supports this feature. Include:
1. Current implementation status
2. Key capabilities
3. Limitations or gaps
4. Comparison to industry standards

Write 2-3 paragraphs of detailed analysis.`,
        variables: ["vendor_name", "feature_name", "feature_description"],
        criteriaId: null,
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      
      scoring: {
        id: "default-scoring",
        name: "Default Feature Scoring",
        description: "Score vendor feature support using Harvey Ball scale (0-4)",
        category: "scoring",
        aiProvider: "openai",
        model: "gpt-4o",
        promptTemplate: `Based on this analysis of {{vendor_name}}'s {{feature_name}} feature:

{{commentary}}

Rate the support level on a 0-4 scale:
- 0 = Not Supported (0%)
- 1 = Limited (25%)
- 2 = Partial (50%)
- 3 = Good (75%)
- 4 = Full Support (100%)

Return a JSON object:
{
  "score": <number 0-4>,
  "reasoning": "Brief explanation for the score"
}`,
        variables: ["vendor_name", "feature_name", "commentary"],
        criteriaId: null,
        isDefault: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    };
    
    return defaults[type];
  }

  /**
   * Update job status
   */
  private async updateJobStatus(status: string, currentStep?: string, errorMessage?: string): Promise<void> {
    await storage.updateProductEvaluationJob(this.jobId, {
      status,
      currentStep: currentStep || null,
      errorMessage: errorMessage || null,
      totalTokensUsed: this.totalTokensUsed,
      totalCost: this.totalCost.toString(),
      ...(status === "running" && { startedAt: new Date() }),
      ...(status === "completed" && { completedAt: new Date() }),
      ...(status === "failed" && { completedAt: new Date() }),
    });
  }

  /**
   * Update job progress
   */
  private async updateJobProgress(): Promise<void> {
    await storage.updateProductEvaluationJob(this.jobId, {
      completedSteps: this.completedSteps,
      totalSteps: this.totalSteps,
      totalTokensUsed: this.totalTokensUsed,
      totalCost: this.totalCost.toString(),
    });
  }

  /**
   * Log a step
   */
  private async logStep(
    stepNumber: number,
    stepType: string,
    status: string,
    aiProvider?: string,
    model?: string,
    tokensUsed?: number,
    estimatedCost?: number,
    errorMessage?: string,
    responseContent?: string
  ): Promise<void> {
    await storage.createProductEvaluationJobLog({
      jobId: this.jobId,
      stepNumber,
      stepType,
      status,
      aiProvider: aiProvider || null,
      model: model || null,
      tokensUsed: tokensUsed || null,
      estimatedCost: estimatedCost?.toString() || null,
      errorMessage: errorMessage || null,
      responseContent: responseContent || null,
      ...(status === "running" && { startedAt: new Date() }),
      ...(status === "completed" && { completedAt: new Date() }),
      ...(status === "failed" && { completedAt: new Date() }),
    });
  }
}
