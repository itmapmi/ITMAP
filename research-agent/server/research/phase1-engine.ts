import { storage } from "../storage";
import { providerRegistry } from "../llm/provider-registry";
import { conductWebResearch } from "./web-research";

/**
 * Execute Phase 1: Generate vendor commentary for a specific criterion
 */
export async function executePhase1Evaluation(
  projectId: string,
  vendorId: string,
  criteriaId: string,
  criteriaConfigId: string
): Promise<void> {
  console.log(`[Phase 1] Starting evaluation for vendor=${vendorId}, criteria=${criteriaId}`);

  // Get project, vendor, and criteria config
  const project = await storage.getProjectById(projectId);
  const vendors = await storage.getProjectVendors(projectId);
  const vendor = vendors.find((v) => v.id === vendorId);
  const allCriteria = await storage.getAllCriteria();
  const criterion = allCriteria.find((c) => c.id === criteriaId);
  const configs = await storage.getProjectCriteriaConfigs(projectId);
  const config = configs.find((c) => c.id === criteriaConfigId);

  if (!project || !vendor || !criterion || !config) {
    throw new Error("Invalid project, vendor, criteria, or config");
  }

  // Create evaluation record with pending status
  const evaluation = await storage.createEvaluation({
    projectId,
    vendorId,
    criteriaId,
    commentary: "",
    sources: [],
    llmProvider: config.llmProvider,
    llmModel: config.llmModel,
    promptUsed: "",
    wordCount: 0,
    status: "running",
    errorMessage: null,
    completedAt: null,
  });

  try {
    // Conduct web research
    const { context, sources } = await conductWebResearch(
      vendor.name,
      vendor.website,
      criterion.name,
      criterion.description
    );

    // Build prompt
    const basePrompt = config.customPrompt || 
      `Analyze ${vendor.name} regarding the following criterion: ${criterion.name}\n\n` +
      `Description: ${criterion.description || "No additional description provided"}\n\n` +
      `Provide a factual, objective commentary of NO MORE than 200 words. ` +
      `Focus on specific capabilities, features, and measurable aspects. ` +
      `Include concrete examples where possible.`;

    const fullPrompt = `${basePrompt}\n\n` +
      `Research Context:\n${context}\n\n` +
      `Vendor Website: ${vendor.website || "Not provided"}\n\n` +
      `IMPORTANT: Your response must be 200 words or less. Be concise and factual.`;

    // Get LLM provider and generate commentary
    const provider = providerRegistry.getProvider(config.llmProvider);
    const commentary = await provider.generateText(fullPrompt, {
      model: config.llmModel,
      maxTokens: 500,
      temperature: 0.3,
    });

    // Count words (simple implementation)
    const wordCount = commentary.trim().split(/\s+/).length;

    // Truncate if over 200 words
    let finalCommentary = commentary;
    if (wordCount > 200) {
      const words = commentary.split(/\s+/).slice(0, 200);
      finalCommentary = words.join(" ") + "...";
    }

    // Update evaluation with results
    await storage.updateEvaluation(evaluation.id, {
      commentary: finalCommentary,
      sources,
      promptUsed: fullPrompt,
      wordCount: Math.min(wordCount, 200),
      status: "completed",
      completedAt: new Date(),
    });

    console.log(`[Phase 1] Completed evaluation ${evaluation.id} - ${wordCount} words`);
  } catch (error: any) {
    console.error(`[Phase 1] Error in evaluation ${evaluation.id}:`, error);
    
    await storage.updateEvaluation(evaluation.id, {
      status: "failed",
      errorMessage: error.message,
      completedAt: new Date(),
    });

    throw error;
  }
}

/**
 * Execute Phase 1 for all vendors and criteria in a project
 */
export async function executePhase1ForProject(projectId: string): Promise<void> {
  console.log(`[Phase 1] Starting Phase 1 for project ${projectId}`);

  // Update project status
  await storage.updateProject(projectId, { status: "phase1_running" });

  try {
    const vendors = await storage.getProjectVendors(projectId);
    const configs = await storage.getProjectCriteriaConfigs(projectId);
    const enabledConfigs = configs.filter((c) => c.enabled);

    console.log(`[Phase 1] Processing ${vendors.length} vendors x ${enabledConfigs.length} criteria`);

    // Process each vendor-criterion combination
    for (const vendor of vendors) {
      for (const config of enabledConfigs) {
        try {
          await executePhase1Evaluation(
            projectId,
            vendor.id,
            config.criteriaId,
            config.id
          );
        } catch (error) {
          console.error(`[Phase 1] Failed evaluation for ${vendor.name} - ${config.criteriaId}:`, error);
          // Continue with other evaluations
        }
      }
    }

    // Update project status
    await storage.updateProject(projectId, { status: "phase1_complete" });
    console.log(`[Phase 1] Completed Phase 1 for project ${projectId}`);
  } catch (error) {
    console.error(`[Phase 1] Error in project ${projectId}:`, error);
    await storage.updateProject(projectId, { status: "failed" });
    throw error;
  }
}
