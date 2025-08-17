import postgres from 'postgres';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Database connection
const sql = postgres(process.env.DATABASE_URL);

async function matchIBMToHPE() {
  try {
    console.log('Starting IBM-HPE score matching...');

    // Get IBM and HPE vendor IDs
    const vendorResult = await sql`
      SELECT id, name FROM vendors 
      WHERE name IN ('IBM', 'HPE ')
      AND market_id = '15a29a79-b10f-44ad-9aff-1685adb6f4ea'
    `;
    
    const ibmVendor = vendorResult.find(v => v.name === 'IBM');
    const hpeVendor = vendorResult.find(v => v.name === 'HPE ');
    
    if (!ibmVendor || !hpeVendor) {
      throw new Error('IBM or HPE vendor not found');
    }
    
    console.log('IBM Vendor ID:', ibmVendor.id);
    console.log('HPE Vendor ID:', hpeVendor.id);

    // Get all HPE scores
    const hpeScores = await sql`
      SELECT 
        f.name as feature_name,
        fc.name as category_name,
        vfs.support_level as hpe_score
      FROM vendor_feature_support vfs
      JOIN features f ON vfs.feature_id = f.id
      JOIN feature_categories fc ON f.category_id = fc.id
      WHERE vfs.vendor_id = ${hpeVendor.id}
      ORDER BY fc.name, f.name
    `;

    console.log(`Found ${hpeScores.length} HPE features to match`);

    // Update IBM scores to match HPE
    let updatedCount = 0;
    let ecosystemFeatures = 0;
    let productFeatures = 0;
    
    for (const hpeFeature of hpeScores) {
      try {
        const result = await sql`
          UPDATE vendor_feature_support 
          SET support_level = ${hpeFeature.hpe_score}
          WHERE vendor_id = ${ibmVendor.id}
          AND feature_id = (
            SELECT f.id FROM features f
            JOIN feature_categories fc ON f.category_id = fc.id
            WHERE f.name = ${hpeFeature.feature_name}
            AND fc.name = ${hpeFeature.category_name}
          )
        `;
        
        if (result.count > 0) {
          updatedCount++;
          if (hpeFeature.category_name === 'Ecosystem Support') {
            ecosystemFeatures++;
          } else {
            productFeatures++;
          }
          console.log(`✓ Updated ${hpeFeature.feature_name}: ${hpeFeature.hpe_score}`);
        } else {
          console.log(`✗ Feature not found: ${hpeFeature.feature_name} (${hpeFeature.category_name})`);
        }
      } catch (error) {
        console.error(`Error updating ${hpeFeature.feature_name}:`, error.message);
      }
    }

    console.log(`\nUpdate Summary:`);
    console.log(`- Updated ${updatedCount} total features`);
    console.log(`- Ecosystem Support features: ${ecosystemFeatures}`);
    console.log(`- Product Capability features: ${productFeatures}`);

    // Calculate new normalized scores for IBM
    const ecosystemScores = hpeScores
      .filter(f => f.category_name === 'Ecosystem Support')
      .map(f => f.hpe_score);
    
    const productScores = hpeScores
      .filter(f => f.category_name !== 'Ecosystem Support')
      .map(f => f.hpe_score);

    const ecosystemTotal = ecosystemScores.reduce((sum, score) => sum + score, 0);
    const ecosystemNormalized = Number(((ecosystemTotal / (ecosystemScores.length * 4)) * 10).toFixed(2));
    
    const productTotal = productScores.reduce((sum, score) => sum + score, 0);
    const productNormalized = Number(((productTotal / (productScores.length * 4)) * 10).toFixed(2));

    console.log(`\nCalculated normalized scores:`);
    console.log(`Ecosystem Support: ${ecosystemNormalized}/10`);
    console.log(`Product Capabilities: ${productNormalized}/10`);

    // Update vendor evaluation scores
    await sql`
      UPDATE vendor_scores 
      SET score = ${ecosystemNormalized}
      WHERE vendor_id = ${ibmVendor.id}
      AND criteria_id = (SELECT id FROM criteria WHERE name = 'ISV Ecosystem')
    `;
    console.log('✓ Updated ISV Ecosystem score');

    await sql`
      UPDATE vendor_scores 
      SET score = ${productNormalized}
      WHERE vendor_id = ${ibmVendor.id}
      AND criteria_id = (SELECT id FROM criteria WHERE name = 'Product Capabilities')
    `;
    console.log('✓ Updated Product Capabilities score');

    console.log('\n=== IBM NOW MATCHES HPE ACROSS ALL FEATURES ===');
    console.log('IBM scores have been updated to match HPE exactly.');
    console.log(`Final scores: Ecosystem (${ecosystemNormalized}), Product (${productNormalized})`);

  } catch (error) {
    console.error('Error matching IBM to HPE:', error);
  } finally {
    await sql.end();
  }
}

// Run the update
matchIBMToHPE();