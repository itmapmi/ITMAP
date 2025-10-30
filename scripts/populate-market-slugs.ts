import { db } from "../server/db";
import { markets } from "@shared/schema";
import { sql } from "drizzle-orm";

// Helper function to generate URL-friendly slug from name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .trim();
}

async function populateMarketSlugs() {
  console.log('Starting to populate market slugs...');
  
  // Get all markets
  const allMarkets = await db.select().from(markets);
  console.log(`Found ${allMarkets.length} markets`);
  
  const slugCounts = new Map<string, number>();
  
  for (const market of allMarkets) {
    if (!market.slug || market.slug === '') {
      let baseSlug = generateSlug(market.name);
      let finalSlug = baseSlug;
      
      // Handle collisions
      const count = slugCounts.get(baseSlug) || 0;
      if (count > 0) {
        finalSlug = `${baseSlug}-${count + 1}`;
      }
      slugCounts.set(baseSlug, count + 1);
      
      // Update the market
      await db
        .update(markets)
        .set({ slug: finalSlug })
        .where(sql`${markets.id} = ${market.id}`);
      
      console.log(`Updated market "${market.name}" with slug: ${finalSlug}`);
    } else {
      console.log(`Market "${market.name}" already has slug: ${market.slug}`);
    }
  }
  
  console.log('Finished populating market slugs!');
  process.exit(0);
}

populateMarketSlugs().catch((error) => {
  console.error('Error populating market slugs:', error);
  process.exit(1);
});
