import { db } from "./db";
import { evaluationCriteria } from "@shared/schema";

const DEFAULT_CRITERIA = [
  {
    name: "Product Capabilities",
    description: "Core features, functionality, and technical capabilities of the vendor's solution",
    defaultOrder: 1,
    isSystemDefined: true,
  },
  {
    name: "ISV Ecosystem",
    description: "Third-party integrations, partnerships, and ecosystem support",
    defaultOrder: 2,
    isSystemDefined: true,
  },
  {
    name: "Innovation",
    description: "R&D investment, product roadmap, and innovative capabilities",
    defaultOrder: 3,
    isSystemDefined: true,
  },
  {
    name: "Pricing Strategy",
    description: "Pricing model, cost-effectiveness, and value proposition",
    defaultOrder: 4,
    isSystemDefined: true,
  },
  {
    name: "Partner Strategy",
    description: "Partner network, channel approach, and partner ecosystem",
    defaultOrder: 5,
    isSystemDefined: true,
  },
  {
    name: "Revenue",
    description: "Financial performance, market share, and revenue growth",
    defaultOrder: 6,
    isSystemDefined: true,
  },
  {
    name: "Business Model",
    description: "Go-to-market strategy, sales approach, and business model",
    defaultOrder: 7,
    isSystemDefined: true,
  },
  {
    name: "Customer Experience",
    description: "Support quality, customer satisfaction, and user experience",
    defaultOrder: 8,
    isSystemDefined: true,
  },
];

async function seed() {
  console.log("Seeding database with default criteria...");

  try {
    for (const criteria of DEFAULT_CRITERIA) {
      await db.insert(evaluationCriteria).values(criteria).onConflictDoNothing();
      console.log(`✓ Added criteria: ${criteria.name}`);
    }

    console.log("\nSeeding completed successfully!");
  } catch (error) {
    console.error("Seeding failed:", error);
    process.exit(1);
  }

  process.exit(0);
}

seed();
