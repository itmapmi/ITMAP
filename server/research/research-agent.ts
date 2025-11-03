import { storage } from "../storage";
import { callOpenAI, callOpenAIDeepResearch, callPerplexity, type AIResponse } from "./ai-providers";
import { fillPromptTemplate } from "./prompt-templates";
import type { ResearchJob, ResearchPromptTemplate } from "@shared/schema";

/**
 * Extract JSON from markdown code blocks
 * Handles cases where AI returns ```json ... ``` wrapped responses
 */
function extractJSON(text: string): string {
  const trimmed = text.trim();
  
  // Check if wrapped in markdown code blocks
  const jsonBlockMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (jsonBlockMatch) {
    return jsonBlockMatch[1].trim();
  }
  
  return trimmed;
}

export interface ResearchJobProgress {
  jobId: string;
  status: string;
  currentStep: string;
  completedSteps: number;
  totalSteps: number;
  totalTokensUsed: number;
  estimatedCost: number;
}

/**
 * Main research agent orchestrator
 * Coordinates AI calls to automate vendor evaluation research
 */
export class ResearchAgent {
  private jobId: string;
  private marketId: string;
  private vendorIds: string[];
  private selectedCriteria?: string[]; // Specific criteria to process (if empty/undefined, process all)
  private featurePromptId?: string;
  private commentaryPromptId?: string;
  private scoringPromptId?: string;
  private criteriaPrompts?: Record<string, string>; // Map of criterionId -> promptId for commentary
  private criteriaScores?: Record<string, string>; // Map of criterionId -> promptId for scoring
  
  private totalSteps: number = 0;
  private completedSteps: number = 0;
  private totalTokensUsed: number = 0;
  private totalCost: number = 0;

  constructor(
    jobId: string,
    marketId: string,
    vendorIds: string[],
    featurePromptId?: string,
    commentaryPromptId?: string,
    scoringPromptId?: string,
    criteriaPrompts?: Record<string, string>,
    criteriaScores?: Record<string, string>,
    selectedCriteria?: string[]
  ) {
    this.jobId = jobId;
    this.marketId = marketId;
    this.vendorIds = vendorIds;
    this.featurePromptId = featurePromptId;
    this.commentaryPromptId = commentaryPromptId;
    this.scoringPromptId = scoringPromptId;
    this.criteriaPrompts = criteriaPrompts;
    this.criteriaScores = criteriaScores;
    this.selectedCriteria = selectedCriteria;
  }

  /**
   * Check if the job has been cancelled
   */
  private async checkCancellation(): Promise<void> {
    const job = await storage.getResearchJob(this.jobId);
    if (job?.status === "cancelled") {
      throw new Error("Job cancelled by user");
    }
  }

  /**
   * Execute the full research automation workflow
   */
  async execute(jobType: string): Promise<void> {
    try {
      await this.updateJobStatus("running", "Initializing research agent...");
      
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

      // Get all criteria for this market
      const allCriteria = await storage.getAllCriteria();
      
      // Filter criteria based on selectedCriteria
      const criteriaToProcess = this.selectedCriteria && this.selectedCriteria.length > 0
        ? allCriteria.filter(c => this.selectedCriteria!.includes(c.id))
        : allCriteria;
      
      console.log(`[Research Agent] Processing ${criteriaToProcess.length} criteria out of ${allCriteria.length} total`);
      
      // Calculate total steps based on job type
      this.totalSteps = this.calculateTotalSteps(jobType, validVendors.length, criteriaToProcess.length);
      await this.updateJobProgress();

      // Execute based on job type
      if (jobType === "full_automation") {
        // Step 1: Generate features
        await this.checkCancellation();
        await this.generateFeatures(market);
        
        // Step 2: Generate commentary for each vendor x criteria
        for (const vendor of validVendors) {
          for (const criterion of criteriaToProcess) {
            await this.checkCancellation();
            await this.generateCommentary(market, vendor, criterion);
          }
        }
        
        // Step 3: Generate scores for each vendor x criteria
        for (const vendor of validVendors) {
          for (const criterion of criteriaToProcess) {
            await this.checkCancellation();
            await this.generateScore(market, vendor, criterion);
          }
        }
      } else if (jobType === "features_only") {
        await this.checkCancellation();
        await this.generateFeatures(market);
      } else if (jobType === "commentary_only") {
        for (const vendor of validVendors) {
          for (const criterion of criteriaToProcess) {
            await this.checkCancellation();
            await this.generateCommentary(market, vendor, criterion);
          }
        }
      } else if (jobType === "scoring_only") {
        for (const vendor of validVendors) {
          for (const criterion of criteriaToProcess) {
            await this.checkCancellation();
            await this.generateScore(market, vendor, criterion);
          }
        }
      }

      await this.updateJobStatus("completed", "Research automation completed successfully");
    } catch (error: any) {
      // Check if it was a cancellation
      if (error.message === "Job cancelled by user") {
        console.log(`[Research Agent] Job ${this.jobId} was cancelled by user`);
        await this.updateJobStatus("cancelled", "Job cancelled by user");
        return; // Exit gracefully without throwing
      }
      
      console.error(`[Research Agent] Job ${this.jobId} failed:`, error);
      await this.updateJobStatus("failed", `Job failed: ${error.message}`, error.message);
      throw error;
    }
  }

  /**
   * Generate feature categories and features using GPT-4o Deep Research
   */
  private async generateFeatures(market: any): Promise<void> {
    const stepNumber = ++this.completedSteps;
    await this.updateJobStatus("running", `Generating feature categories and features...`);
    
    try {
      // Load feature generation prompt template
      const template = await this.getPromptTemplate("feature_generation");
      
      const prompt = fillPromptTemplate(template.promptTemplate, {
        market_name: market.name,
        market_description: market.description || market.shortDescription || "",
      });

      await this.logStep(stepNumber, "feature_generation", "running", template);

      // Call OpenAI with the prompt
      const response = await callOpenAI(prompt, template.model);
      
      // Parse JSON response (handle markdown code blocks)
      const jsonText = extractJSON(response.content);
      const data = JSON.parse(jsonText);
      
      // Create feature categories and features in database
      for (const category of data.categories) {
        const newCategory = await storage.createFeatureCategory({
          marketId: this.marketId,
          name: category.name,
          description: category.description,
          displayOrder: 0,
        });
        
        for (const feature of category.features) {
          await storage.createFeature({
            categoryId: newCategory.id,
            name: feature.name,
            description: feature.description,
            displayOrder: 0,
          });
        }
      }

      // Update tracking
      this.totalTokensUsed += response.tokensUsed;
      this.totalCost += response.estimatedCost;
      
      await this.logStep(
        stepNumber,
        "feature_generation",
        "completed",
        template,
        response.content,
        response.tokensUsed,
        response.estimatedCost
      );
      
      await this.updateJobProgress();
      
      console.log(`[Research Agent] Generated ${data.categories.length} feature categories`);
    } catch (error: any) {
      await this.logStep(stepNumber, "feature_generation", "failed", undefined, undefined, 0, 0, error.message);
      throw error;
    }
  }

  /**
   * Generate commentary for a vendor's performance on a criterion using OpenAI Deep Research
   */
  private async generateCommentary(market: any, vendor: any, criterion: any): Promise<void> {
    const stepNumber = ++this.completedSteps;
    await this.updateJobStatus(
      "running",
      `Generating commentary for ${vendor.name} - ${criterion.name}...`
    );
    
    try {
      // Load criterion-specific prompt or fall back to default
      let template: ResearchPromptTemplate;
      
      if (this.criteriaPrompts && this.criteriaPrompts[criterion.id]) {
        const criterionPromptId = this.criteriaPrompts[criterion.id];
        console.log(`[Research Agent] Using criterion-specific prompt ${criterionPromptId} for ${criterion.name}`);
        const customTemplate = await storage.getResearchPromptTemplate(criterionPromptId);
        if (customTemplate) {
          template = customTemplate;
        } else {
          console.warn(`[Research Agent] Criterion prompt ${criterionPromptId} not found, using default`);
          template = await this.getPromptTemplate("commentary_generation");
        }
      } else {
        template = await this.getPromptTemplate("commentary_generation");
      }
      
      const prompt = fillPromptTemplate(template.promptTemplate, {
        market_name: market.name,
        vendor_name: vendor.name,
        criteria_name: criterion.name,
        criteria_description: criterion.description || "",
      });

      await this.logStep(stepNumber, "commentary", "running", template);

      // Call OpenAI Deep Research with web search
      const response = await callOpenAIDeepResearch(prompt, template.model);
      
      // Save or update the commentary in vendor_scores
      const existingScore = await storage.getVendorScoreByCriteria(vendor.id, criterion.id);
      
      if (existingScore) {
        await storage.updateVendorScore(existingScore.id, {
          notes: response.content,
        });
      } else {
        await storage.createVendorScore({
          vendorId: vendor.id,
          criteriaId: criterion.id,
          score: 0, // Will be filled in scoring step
          notes: response.content,
        });
      }

      this.totalTokensUsed += response.tokensUsed;
      this.totalCost += response.estimatedCost;
      
      await this.logStep(
        stepNumber,
        "commentary",
        "completed",
        template,
        response.content.substring(0, 500) + "...", // Truncate for storage
        response.tokensUsed,
        response.estimatedCost
      );
      
      await this.updateJobProgress();
    } catch (error: any) {
      await this.logStep(stepNumber, "commentary", "failed", undefined, undefined, 0, 0, error.message);
      // Don't throw - continue with other vendors
      console.error(`[Research Agent] Commentary generation failed for ${vendor.name} - ${criterion.name}:`, error);
    }
  }

  /**
   * Generate score for a vendor's performance on a criterion using GPT-4o
   */
  private async generateScore(market: any, vendor: any, criterion: any): Promise<void> {
    const stepNumber = ++this.completedSteps;
    await this.updateJobStatus(
      "running",
      `Scoring ${vendor.name} - ${criterion.name}...`
    );
    
    try {
      // Load criterion-specific scoring prompt or fall back to default
      let template: ResearchPromptTemplate;
      
      if (this.criteriaScores && this.criteriaScores[criterion.id]) {
        const criterionScoreId = this.criteriaScores[criterion.id];
        console.log(`[Research Agent] Using criterion-specific scoring prompt ${criterionScoreId} for ${criterion.name}`);
        const customTemplate = await storage.getResearchPromptTemplate(criterionScoreId);
        if (customTemplate) {
          template = customTemplate;
        } else {
          console.log(`[Research Agent] Criterion scoring prompt not found, falling back to default`);
          template = await this.getPromptTemplate("scoring");
        }
      } else {
        template = await this.getPromptTemplate("scoring");
      }
      
      // Get existing commentary
      const existingScore = await storage.getVendorScoreByCriteria(vendor.id, criterion.id);
      const commentary = existingScore?.notes || "No commentary available.";
      
      const prompt = fillPromptTemplate(template.promptTemplate, {
        market_name: market.name,
        vendor_name: vendor.name,
        criteria_name: criterion.name,
        criteria_description: criterion.description || "",
        commentary,
      });

      await this.logStep(stepNumber, "scoring", "running", template);

      // Call OpenAI for scoring
      const response = await callOpenAI(prompt, template.model);
      
      // Parse JSON response (handle markdown code blocks)
      const jsonText = extractJSON(response.content);
      const data = JSON.parse(jsonText);
      const score = Math.max(0, Math.min(10, data.score)); // Clamp to 0-10
      
      // Update the score
      if (existingScore) {
        await storage.updateVendorScore(existingScore.id, {
          score,
        });
      } else {
        await storage.createVendorScore({
          vendorId: vendor.id,
          criteriaId: criterion.id,
          score,
          notes: commentary,
        });
      }

      this.totalTokensUsed += response.tokensUsed;
      this.totalCost += response.estimatedCost;
      
      await this.logStep(
        stepNumber,
        "scoring",
        "completed",
        template,
        `Score: ${score} - ${data.justification}`,
        response.tokensUsed,
        response.estimatedCost
      );
      
      await this.updateJobProgress();
    } catch (error: any) {
      await this.logStep(stepNumber, "scoring", "failed", undefined, undefined, 0, 0, error.message);
      // Don't throw - continue with other vendors
      console.error(`[Research Agent] Scoring failed for ${vendor.name} - ${criterion.name}:`, error);
    }
  }

  /**
   * Get prompt template from database or use default
   */
  private async getPromptTemplate(category: string): Promise<ResearchPromptTemplate> {
    // Try to get from job configuration using the stored prompt IDs
    let templateId: string | undefined;
    
    if (category === "feature_generation") {
      templateId = this.featurePromptId;
    } else if (category === "commentary_generation") {
      templateId = this.commentaryPromptId;
    } else if (category === "scoring") {
      templateId = this.scoringPromptId;
    }
    
    if (templateId) {
      console.log(`[Research Agent] Loading custom template ID: ${templateId} for category: ${category}`);
      const template = await storage.getResearchPromptTemplate(templateId);
      if (template) {
        console.log(`[Research Agent] Using custom template: ${template.name}`);
        return template;
      }
      console.warn(`[Research Agent] Template ${templateId} not found, falling back to default`);
    }
    
    // Fall back to default template
    console.log(`[Research Agent] Using default template for category: ${category}`);
    const defaults = await import("./prompt-templates");
    const defaultTemplate = category === "feature_generation"
      ? defaults.DEFAULT_PROMPTS.FEATURE_GENERATION
      : category === "commentary_generation"
      ? defaults.DEFAULT_PROMPTS.COMMENTARY_GENERATION
      : defaults.DEFAULT_PROMPTS.SCORING_GENERATION;
    
    return defaultTemplate as any;
  }

  /**
   * Calculate total steps based on job type
   */
  private calculateTotalSteps(jobType: string, vendorCount: number, criteriaCount: number): number {
    let steps = 0;
    
    if (jobType === "full_automation") {
      steps += 1; // Feature generation
      steps += vendorCount * criteriaCount; // Commentary
      steps += vendorCount * criteriaCount; // Scoring
    } else if (jobType === "features_only") {
      steps = 1;
    } else if (jobType === "commentary_only") {
      steps = vendorCount * criteriaCount;
    } else if (jobType === "scoring_only") {
      steps = vendorCount * criteriaCount;
    }
    
    return steps;
  }

  /**
   * Update job status in database
   */
  private async updateJobStatus(status: string, currentStep: string, errorMessage?: string): Promise<void> {
    await storage.updateResearchJob(this.jobId, {
      status,
      currentStep,
      errorMessage,
      ...(status === "running" && !await this.getJobStartedAt() ? { startedAt: new Date() } : {}),
      ...(status === "completed" || status === "failed" ? { completedAt: new Date() } : {}),
    });
  }

  /**
   * Update job progress metrics
   */
  private async updateJobProgress(): Promise<void> {
    await storage.updateResearchJob(this.jobId, {
      totalSteps: this.totalSteps,
      completedSteps: this.completedSteps,
      totalTokensUsed: this.totalTokensUsed,
      estimatedCost: this.totalCost.toString(),
    });
  }

  /**
   * Log a step in the research process
   */
  private async logStep(
    stepNumber: number,
    stepType: string,
    status: string,
    template?: ResearchPromptTemplate,
    responseContent?: string,
    tokensUsed?: number,
    estimatedCost?: number,
    errorMessage?: string
  ): Promise<void> {
    await storage.createResearchJobLog({
      jobId: this.jobId,
      stepNumber,
      stepType,
      status,
      aiProvider: template?.aiProvider,
      model: template?.model,
      promptUsed: template?.promptTemplate.substring(0, 1000), // Truncate
      responseContent,
      tokensUsed,
      estimatedCost: estimatedCost?.toString(),
      errorMessage,
      ...(status === "running" ? { startedAt: new Date() } : {}),
      ...(status === "completed" || status === "failed" ? { completedAt: new Date() } : {}),
    });
  }

  /**
   * Get job started timestamp
   */
  private async getJobStartedAt(): Promise<Date | null> {
    const job = await storage.getResearchJob(this.jobId);
    return job?.startedAt || null;
  }
}
