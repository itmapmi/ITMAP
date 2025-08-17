import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';
import postgres from 'postgres';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Database connection
const sql = postgres(process.env.DATABASE_URL);

// Harvey Ball to numeric mapping
const harveyBallMap = {
  '●': 4, // Full
  '◕': 3, // Good
  '◑': 2, // Partial
  '◔': 1, // Limited
  '○': 0  // None
};

async function updateIBMScores() {
  try {
    // Read the Excel file
    const filePath = path.join(__dirname, 'attached_assets', 'high_end_storage_support_matrix_fs9500_1755435481069.xlsx');
    const workbook = XLSX.readFile(filePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    // Get IBM vendor ID
    const vendorResult = await sql`
      SELECT id FROM vendors 
      WHERE name = 'IBM' 
      AND market_id = '15a29a79-b10f-44ad-9aff-1685adb6f4ea'
    `;
    
    if (vendorResult.length === 0) {
      throw new Error('IBM vendor not found');
    }
    
    const ibmVendorId = vendorResult[0].id;
    console.log('IBM Vendor ID:', ibmVendorId);

    // Extract IBM scores from Excel
    const featureUpdates = [];
    const ecosystemScores = [];
    const productCapabilityScores = [];
    
    for (const row of data) {
      if (row && row.length >= 3 && row.some(cell => cell && cell.toString().toLowerCase().includes('ibm'))) {
        const category = row[0];
        const feature = row[1];
        const harveyBall = row[2];
        const score = harveyBallMap[harveyBall] || 0;
        
        // Skip the header row that just says "Feature"
        if (feature === 'Feature') continue;
        
        featureUpdates.push({ category, feature, score });
        
        if (category === 'Ecosystem Support') {
          ecosystemScores.push(score);
        } else {
          productCapabilityScores.push(score);
        }
      }
    }

    console.log(`Found ${featureUpdates.length} features to update`);
    console.log(`Ecosystem features: ${ecosystemScores.length}`);
    console.log(`Product capability features: ${productCapabilityScores.length}`);

    // Update individual feature support levels
    let updatedFeatures = 0;
    for (const update of featureUpdates) {
      try {
        const result = await sql`
          UPDATE vendor_feature_support 
          SET support_level = ${update.score}
          WHERE vendor_id = ${ibmVendorId}
          AND feature_id = (
            SELECT id FROM features 
            WHERE name = ${update.feature}
            AND category_id = (
              SELECT id FROM feature_categories 
              WHERE name = ${update.category}
            )
          )
        `;
        
        if (result.count > 0) {
          updatedFeatures++;
          console.log(`✓ Updated ${update.feature}: ${update.score}`);
        } else {
          console.log(`✗ Feature not found: ${update.feature} (${update.category})`);
        }
      } catch (error) {
        console.error(`Error updating ${update.feature}:`, error.message);
      }
    }

    // Calculate normalized scores
    const ecosystemTotal = ecosystemScores.reduce((sum, score) => sum + score, 0);
    const ecosystemNormalized = Number(((ecosystemTotal / (ecosystemScores.length * 4)) * 10).toFixed(2));
    
    const productTotal = productCapabilityScores.reduce((sum, score) => sum + score, 0);
    const productNormalized = Number(((productTotal / (productCapabilityScores.length * 4)) * 10).toFixed(2));

    console.log(`\nCalculated scores:`);
    console.log(`Ecosystem Support: ${ecosystemNormalized}/10`);
    console.log(`Product Capabilities: ${productNormalized}/10`);

    // Update ISV Ecosystem score
    await sql`
      UPDATE vendor_scores 
      SET score = ${ecosystemNormalized}
      WHERE vendor_id = ${ibmVendorId}
      AND criteria_id = (SELECT id FROM criteria WHERE name = 'ISV Ecosystem')
    `;
    console.log('✓ Updated ISV Ecosystem score');

    // Update Product Capabilities score
    await sql`
      UPDATE vendor_scores 
      SET score = ${productNormalized}
      WHERE vendor_id = ${ibmVendorId}
      AND criteria_id = (SELECT id FROM criteria WHERE name = 'Product Capabilities')
    `;
    console.log('✓ Updated Product Capabilities score');

    console.log(`\nUpdate completed:`);
    console.log(`- Updated ${updatedFeatures} feature support levels`);
    console.log(`- Updated ISV Ecosystem score to ${ecosystemNormalized}`);
    console.log(`- Updated Product Capabilities score to ${productNormalized}`);

  } catch (error) {
    console.error('Error updating IBM scores:', error);
  } finally {
    await sql.end();
  }
}

// Run the update
updateIBMScores();