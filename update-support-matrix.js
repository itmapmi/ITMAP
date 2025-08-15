import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { config } from 'dotenv';

// Load environment variables
config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import database connection
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { eq, and } from 'drizzle-orm';

// Import schema
const { vendors, features, featureCategories, vendorFeatureSupport, markets } = await import('./shared/schema.ts');

// Database connection
const client = postgres(process.env.DATABASE_URL);
const db = drizzle(client);

// Harvey Ball to numeric conversion
const harveyBallToLevel = {
  '●': 4, // Full support
  '◕': 3, // Good support  
  '◑': 2, // Partial support
  '◔': 1, // Limited support
  '○': 0, // No support
  '': 0   // Empty = no support
};

// Read processed data
const processedData = JSON.parse(fs.readFileSync('processed-support-matrix.json', 'utf8'));

async function updateSupportMatrix() {
  console.log('Starting support matrix update...');
  console.log(`Processing ${processedData.vendors.length} vendors and ${processedData.features.length} features`);
  
  try {
    // Get the High-End Storage market ID (assuming this is the market we're updating)
    const marketResult = await db.select().from(markets).where(eq(markets.name, 'High-End Storage'));
    if (marketResult.length === 0) {
      throw new Error('High-End Storage market not found');
    }
    const marketId = marketResult[0].id;
    console.log('Market ID:', marketId);

    // Get existing vendors from database
    const existingVendors = await db.select().from(vendors).where(eq(vendors.marketId, marketId));
    const vendorMap = {};
    existingVendors.forEach(v => {
      vendorMap[v.product || v.name] = v.id;
    });
    
    console.log('Existing vendors:', Object.keys(vendorMap));

    // Get existing categories and create mapping
    const existingCategories = await db.select().from(featureCategories);
    const categoryMap = {};
    existingCategories.forEach(c => categoryMap[c.name] = c);

    // Create feature categories that don't exist
    for (const categoryName of processedData.summary.categories) {
      if (!categoryMap[categoryName]) {
        console.log(`Creating category: ${categoryName}`);
        const [newCategory] = await db.insert(featureCategories).values({
          name: categoryName,
          displayOrder: Object.keys(categoryMap).length + 1
        }).returning();
        categoryMap[categoryName] = newCategory;
      }
    }

    // Get existing features
    const existingFeatures = await db.select().from(features);
    const featureMap = {};
    existingFeatures.forEach(f => featureMap[f.name] = f);

    // Process each feature from the Excel data
    let updatedCount = 0;
    let createdCount = 0;
    
    for (const excelFeature of processedData.features) {
      const { category, name, support } = excelFeature;
      
      // Create feature if it doesn't exist
      let feature = featureMap[name];
      if (!feature) {
        console.log(`Creating feature: ${name}`);
        const [newFeature] = await db.insert(features).values({
          name: name,
          description: `${category} - ${name}`,
          categoryId: categoryMap[category].id,
          displayOrder: Object.keys(featureMap).length + 1
        }).returning();
        feature = newFeature;
        featureMap[name] = feature;
        createdCount++;
      }

      // Update support levels for each vendor
      for (const [vendorProduct, supportInfo] of Object.entries(support)) {
        const vendorId = vendorMap[vendorProduct];
        if (!vendorId) {
          console.log(`Warning: Vendor not found: ${vendorProduct}`);
          continue;
        }

        const supportLevel = harveyBallToLevel[supportInfo.level] || 0;
        const notes = supportInfo.notes || '';

        // Check if support record exists
        const existingSupport = await db.select().from(vendorFeatureSupport)
          .where(and(
            eq(vendorFeatureSupport.vendorId, vendorId),
            eq(vendorFeatureSupport.featureId, feature.id)
          ));

        if (existingSupport.length > 0) {
          // Update existing record
          await db.update(vendorFeatureSupport)
            .set({ 
              supportLevel,
              notes,
              updatedAt: new Date()
            })
            .where(and(
              eq(vendorFeatureSupport.vendorId, vendorId),
              eq(vendorFeatureSupport.featureId, feature.id)
            ));
          updatedCount++;
        } else {
          // Create new record
          await db.insert(vendorFeatureSupport).values({
            vendorId,
            featureId: feature.id,
            supportLevel,
            notes
          });
          createdCount++;
        }
      }
    }

    console.log('\n=== UPDATE COMPLETE ===');
    console.log(`Created ${createdCount} new support records`);
    console.log(`Updated ${updatedCount} existing support records`);
    console.log(`Total features processed: ${processedData.features.length}`);
    console.log(`Total categories: ${processedData.summary.categories.length}`);
    
  } catch (error) {
    console.error('Error updating support matrix:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the update
updateSupportMatrix().catch(console.error);