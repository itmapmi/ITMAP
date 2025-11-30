import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';
import postgres from 'postgres';

const MARKET_ID = 'e1bc70e0-7b65-48c8-abe3-2541eedd0157';

// Connect to database
const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  const filePath = path.join(process.cwd(), 'attached_assets/ITMAP_for_Public_Cloud_Object_Storage_providers_export1_1764490472014.xlsx');
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

  // Parse Product Evaluation sheet
  const productSheet = workbook.Sheets['Product Evaluation'];
  const productData = xlsx.utils.sheet_to_json(productSheet, { header: 1 }) as any[][];

  // Extract header row (feature names)
  const headers = productData[0] as string[];

  // Extract all feature names (skip "Vendor Name" and all "- Comments" columns)
  const allFeatures: string[] = [];
  const featureColumnMap: Record<string, { scoreCol: number; commentCol: number }> = {};
  
  for (let i = 1; i < headers.length; i++) {
    const header = headers[i];
    if (header && !header.includes(' - Comments')) {
      const featureName = header.trim().replace(/:/g, '').replace(/"/g, '"');
      allFeatures.push(featureName);
      featureColumnMap[featureName] = {
        scoreCol: i,
        commentCol: i + 1,
      };
    }
  }

  console.log(`Found ${allFeatures.length} features in Excel`);

  // Get all features from DB
  const allDbFeatures = await sql`
    SELECT f.id, f.name
    FROM features f
    JOIN feature_categories fc ON f.category_id = fc.id
    WHERE fc.market_id = ${MARKET_ID}
  `;
  console.log(`Total features in DB: ${allDbFeatures.length}`);

  // Create feature name to ID map (case-insensitive)
  const featureNameToId: Record<string, string> = {};
  for (const f of allDbFeatures) {
    featureNameToId[f.name.toLowerCase()] = f.id;
  }

  // Get vendors
  const vendors = await sql`
    SELECT id, name FROM vendors WHERE market_id = ${MARKET_ID}
  `;
  console.log(`Found ${vendors.length} vendors`);
  
  const vendorNameToId: Record<string, string> = {};
  for (const v of vendors) {
    vendorNameToId[v.name.toLowerCase()] = v.id;
  }

  // Get existing vendor feature support
  const existingSupport = await sql`
    SELECT vfs.id, vfs.vendor_id, vfs.feature_id
    FROM vendor_feature_support vfs
    JOIN features f ON vfs.feature_id = f.id
    JOIN feature_categories fc ON f.category_id = fc.id
    WHERE fc.market_id = ${MARKET_ID}
  `;
  
  const supportKey = (vendorId: string, featureId: string) => `${vendorId}|${featureId}`;
  const existingSupportMap: Record<string, string> = {};
  for (const s of existingSupport) {
    existingSupportMap[supportKey(s.vendor_id, s.feature_id)] = s.id;
  }
  console.log(`Found ${existingSupport.length} existing support records`);

  // Process vendor rows and insert/update support data
  let insertCount = 0;
  let updateCount = 0;
  
  for (let vendorIdx = 1; vendorIdx < productData.length; vendorIdx++) {
    const row = productData[vendorIdx];
    if (!row || !row[0]) continue;

    const vendorName = (row[0] as string).trim();
    const vendorId = vendorNameToId[vendorName.toLowerCase()];
    
    if (!vendorId) {
      console.log(`Vendor not found: ${vendorName}`);
      continue;
    }

    console.log(`Processing vendor: ${vendorName}`);

    for (const featureName of allFeatures) {
      const colInfo = featureColumnMap[featureName];
      if (!colInfo) continue;

      const score = row[colInfo.scoreCol];
      const comment = row[colInfo.commentCol] || '';

      if (score !== undefined && score !== null && score !== '') {
        const rawScore = typeof score === 'number' ? score : parseFloat(score as string);
        const numScore = Math.round(rawScore); // Round to nearest integer for Harvey Ball scale
        
        if (!isNaN(numScore) && numScore >= 0 && numScore <= 4) {
          const featureId = featureNameToId[featureName.toLowerCase()];
          
          if (!featureId) {
            // console.log(`  Feature not found in DB: ${featureName}`);
            continue;
          }

          // Truncate comment to prevent overflow
          const truncatedComment = String(comment).substring(0, 5000);
          const key = supportKey(vendorId, featureId);
          const existingId = existingSupportMap[key];

          if (existingId) {
            // Update existing record
            await sql`
              UPDATE vendor_feature_support 
              SET support_level = ${numScore}, comments = ${truncatedComment}, updated_at = NOW()
              WHERE id = ${existingId}
            `;
            updateCount++;
          } else {
            // Insert new record
            await sql`
              INSERT INTO vendor_feature_support (id, vendor_id, feature_id, support_level, comments, updated_at)
              VALUES (gen_random_uuid(), ${vendorId}, ${featureId}, ${numScore}, ${truncatedComment}, NOW())
            `;
            insertCount++;
          }
        }
      }
    }
  }

  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`New records inserted: ${insertCount}`);
  console.log(`Existing records updated: ${updateCount}`);
  console.log(`Total: ${insertCount + updateCount}`);

  await sql.end();
}

main().catch(console.error);
