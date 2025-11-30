import * as xlsx from 'xlsx';
import * as fs from 'fs';
import postgres from 'postgres';

const MARKET_ID = 'e1bc70e0-7b65-48c8-abe3-2541eedd0157';
const sql = postgres(process.env.DATABASE_URL!);

async function main() {
  // Parse the category/feature structure file
  const structureFile = 'attached_assets/aws_product_evaluation_1764492922890.xlsx';
  const fileBuffer = fs.readFileSync(structureFile);
  const workbook = xlsx.read(fileBuffer, { type: 'buffer' });
  const sheet = workbook.Sheets['Sheet1'];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

  // Get category IDs from database
  const categories = await sql`
    SELECT id, name FROM feature_categories 
    WHERE market_id = ${MARKET_ID}
  `;
  
  const categoryNameToId: Record<string, string> = {};
  for (const cat of categories) {
    categoryNameToId[cat.name] = cat.id;
  }
  
  console.log('Categories found:', Object.keys(categoryNameToId));

  // Track display order per category
  const categoryDisplayOrder: Record<string, number> = {};

  // Skip header row, process features
  let totalCreated = 0;
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length < 2) continue;

    const categoryName = (row[0] as string).trim();
    const featureName = (row[1] as string).trim();

    const categoryId = categoryNameToId[categoryName];
    if (!categoryId) {
      console.log(`Category not found: ${categoryName}`);
      continue;
    }

    // Increment display order for this category
    categoryDisplayOrder[categoryName] = (categoryDisplayOrder[categoryName] || 0) + 1;

    // Insert feature
    await sql`
      INSERT INTO features (id, name, description, category_id, display_order)
      VALUES (gen_random_uuid(), ${featureName}, NULL, ${categoryId}, ${categoryDisplayOrder[categoryName]})
    `;
    totalCreated++;
    console.log(`Created: ${categoryName} -> ${featureName}`);
  }

  console.log(`\n=== COMPLETE ===`);
  console.log(`Total features created: ${totalCreated}`);

  await sql.end();
}

main().catch(console.error);
