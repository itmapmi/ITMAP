import * as xlsx from 'xlsx';
import * as fs from 'fs';
import postgres from 'postgres';

const MARKET_ID = 'e1bc70e0-7b65-48c8-abe3-2541eedd0157';
const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  // Parse the original Product Evaluation Excel
  const filePath = 'attached_assets/ITMAP_for_Public_Cloud_Object_Storage_providers_export1_1764490472014.xlsx';
  const fileBuffer = fs.readFileSync(filePath);
  const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

  const productSheet = workbook.Sheets['Product Evaluation'];
  const productData = xlsx.utils.sheet_to_json(productSheet, { header: 1 }) as any[][];

  // Extract headers (feature names)
  const headers = productData[0] as string[];

  // Build feature column mapping
  const featureColumnMap: Record<string, { scoreCol: number; commentCol: number }> = {};
  for (let i = 1; i < headers.length; i++) {
    const header = headers[i];
    if (header && !header.includes(' - Comments')) {
      // Normalize feature name (remove colons)
      const featureName = header.trim().replace(/:$/, '');
      featureColumnMap[featureName] = {
        scoreCol: i,
        commentCol: i + 1,
      };
    }
  }

  console.log(`Found ${Object.keys(featureColumnMap).length} features in Excel`);

  // Get features from database
  const dbFeatures = await sql`
    SELECT f.id, f.name
    FROM features f
    JOIN feature_categories fc ON f.category_id = fc.id
    WHERE fc.market_id = ${MARKET_ID}
  `;

  // Create normalized feature name to ID map
  const featureNameToId: Record<string, string> = {};
  for (const f of dbFeatures) {
    // Normalize: remove colons, quotes, trim
    const normalized = f.name.toLowerCase().replace(/:/g, '').replace(/"/g, '"').trim();
    featureNameToId[normalized] = f.id;
  }

  console.log(`Found ${dbFeatures.length} features in database`);

  // Get vendors
  const vendors = await sql`
    SELECT id, name FROM vendors WHERE market_id = ${MARKET_ID}
  `;
  
  const vendorNameToId: Record<string, string> = {};
  for (const v of vendors) {
    vendorNameToId[v.name.toLowerCase()] = v.id;
  }

  console.log(`Found ${vendors.length} vendors`);

  // Process vendor rows
  let insertCount = 0;
  let skippedCount = 0;

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

    for (const [excelFeatureName, colInfo] of Object.entries(featureColumnMap)) {
      const score = row[colInfo.scoreCol];
      const comment = row[colInfo.commentCol] || '';

      if (score !== undefined && score !== null && score !== '') {
        const rawScore = typeof score === 'number' ? score : parseFloat(score as string);
        const numScore = Math.round(rawScore);

        if (!isNaN(numScore) && numScore >= 0 && numScore <= 4) {
          // Normalize Excel feature name for matching
          const normalizedExcel = excelFeatureName.toLowerCase().replace(/:/g, '').replace(/"/g, '"').trim();
          
          const featureId = featureNameToId[normalizedExcel];

          if (!featureId) {
            // Try partial match
            let found = false;
            for (const [dbNorm, dbId] of Object.entries(featureNameToId)) {
              if (dbNorm.includes(normalizedExcel) || normalizedExcel.includes(dbNorm)) {
                // Insert with partial match
                const truncatedComment = String(comment).substring(0, 5000);
                await sql`
                  INSERT INTO vendor_feature_support (id, vendor_id, feature_id, support_level, comments, updated_at)
                  VALUES (gen_random_uuid(), ${vendorId}, ${dbId}, ${numScore}, ${truncatedComment}, NOW())
                `;
                insertCount++;
                found = true;
                break;
              }
            }
            if (!found) {
              skippedCount++;
              // console.log(`  Feature not matched: "${excelFeatureName}"`);
            }
            continue;
          }

          const truncatedComment = String(comment).substring(0, 5000);
          await sql`
            INSERT INTO vendor_feature_support (id, vendor_id, feature_id, support_level, comments, updated_at)
            VALUES (gen_random_uuid(), ${vendorId}, ${featureId}, ${numScore}, ${truncatedComment}, NOW())
          `;
          insertCount++;
        }
      }
    }
  }

  console.log(`\n=== IMPORT COMPLETE ===`);
  console.log(`Records inserted: ${insertCount}`);
  console.log(`Skipped (no match): ${skippedCount}`);

  await sql.end();
}

main().catch(console.error);
