import { storage } from "../storage";
import { providerRegistry } from "../llm/provider-registry";

/**
 * Execute Phase 2: Generate scores from commentary
 */
export async function executePhase2Scoring(
  projectId: string,
  vendorId: string,
  criteriaId: string,
  evaluationId: string
): Promise<void> {
  console.log(`[Phase 2] Starting scoring for evaluation=${evaluationId}`);

  // Get evaluation and config
  const evaluations = await storage.getProjectEvaluations(projectId);
  const evaluation = evaluations.find((e) => e.id === evaluationId);
  const phase2ConfigData = await storage.getPhase2Config(projectId);

  if (!evaluation || !phase2ConfigData) {
    throw new Error("Invalid evaluation or Phase 2 config not found");
  }

  if (evaluation.status !== "completed") {
    throw new Error("Cannot score incomplete evaluation");
  }

  // Create score record with pending status
  const score = await storage.createScore({
    projectId,
    vendorId,
    criteriaId,
    evaluationId,
    score: "0.0",
    reasoning: "",
    llmProvider: phase2ConfigData.llmProvider,
    llmModel: phase2ConfigData.llmModel,
    status: "running",
    errorMessage: null,
    completedAt: null,
  });

  try {
    // Build scoring prompt
    const basePrompt = phase2ConfigData.customPrompt ||
      `Analyze the following vendor commentary and assign a score from 0.0 to 10.0.\n\n` +
      `Scoring Guidelines:\n` +
      `- 0-2: Poor/Inadequate\n` +
      `- 3-4: Below Average\n` +
      `- 5-6: Average/Adequate\n` +
      `- 7-8: Above Average/Good\n` +
      `- 9-10: Excellent/Outstanding\n\n` +
      `Consider factors like:\n` +
      `- Comprehensiveness of capabilities\n` +
      `- Market position and differentiation\n` +
      `- Evidence of strength in this criterion\n` +
      `- Competitive advantages mentioned\n\n`;

    const fullPrompt = `${basePrompt}` +
      `Commentary to score:\n\n${evaluation.commentary}\n\n` +
      `Provide your response in this exact format:\n` +
      `Score: X.X\n` +
      `Reasoning: [Your brief explanation of the score]`;

    // Get LLM provider and generate score
    const provider = providerRegistry.getProvider(phase2ConfigData.llmProvider);
    const response = await provider.generateText(fullPrompt, {
      model: phase2ConfigData.llmModel,
      maxTokens: 300,
      temperature: 0.2,
    });

    // Parse response
    const scoreMatch = response.match(/Score:\s*(\d+(?:\.\d+)?)/i);
    const reasoningMatch = response.match(/Reasoning:\s*(.+)/is);

    if (!scoreMatch) {
      throw new Error("Failed to parse score from LLM response");
    }

    let parsedScore = parseFloat(scoreMatch[1]);
    
    // Ensure score is in valid range
    parsedScore = Math.max(0, Math.min(10, parsedScore));
    
    const reasoning = reasoningMatch ? reasoningMatch[1].trim() : "No reasoning provided";

    // Update score with results
    await storage.updateScore(score.id, {
      score: parsedScore.toFixed(1),
      reasoning,
      status: "completed",
      completedAt: new Date(),
    });

    console.log(`[Phase 2] Completed scoring ${score.id} - Score: ${parsedScore}`);
  } catch (error: any) {
    console.error(`[Phase 2] Error in scoring ${score.id}:`, error);
    
    await storage.updateScore(score.id, {
      status: "failed",
      errorMessage: error.message,
      completedAt: new Date(),
    });

    throw error;
  }
}

/**
 * Execute Phase 2 for all evaluations in a project
 */
export async function executePhase2ForProject(projectId: string): Promise<void> {
  console.log(`[Phase 2] Starting Phase 2 for project ${projectId}`);

  // Verify Phase 1 is complete
  const project = await storage.getProjectById(projectId);
  if (!project || project.status !== "phase1_complete") {
    throw new Error("Phase 1 must be complete before starting Phase 2");
  }

  // Update project status
  await storage.updateProject(projectId, { status: "phase2_running" });

  try {
    const evaluations = await storage.getProjectEvaluations(projectId);
    const completedEvaluations = evaluations.filter((e) => e.status === "completed");

    console.log(`[Phase 2] Processing ${completedEvaluations.length} evaluations`);

    // Process each evaluation
    for (const evaluation of completedEvaluations) {
      try {
        await executePhase2Scoring(
          projectId,
          evaluation.vendorId,
          evaluation.criteriaId,
          evaluation.id
        );
      } catch (error) {
        console.error(`[Phase 2] Failed scoring for evaluation ${evaluation.id}:`, error);
        // Continue with other scores
      }
    }

    // Update project status
    await storage.updateProject(projectId, { status: "completed" });
    console.log(`[Phase 2] Completed Phase 2 for project ${projectId}`);
  } catch (error) {
    console.error(`[Phase 2] Error in project ${projectId}:`, error);
    await storage.updateProject(projectId, { status: "failed" });
    throw error;
  }
}
