import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(process.cwd(), 'attached_assets/ITMAP_for_Public_Cloud_Object_Storage_providers_export1_1764490472014.xlsx');

const fileBuffer = fs.readFileSync(filePath);
const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

// Parse Product Evaluation sheet
const productSheet = workbook.Sheets['Product Evaluation'];
const productData = xlsx.utils.sheet_to_json(productSheet, { header: 1 }) as any[][];

// Extract header row (feature names)
const headers = productData[0] as string[];

// Extract feature names (skip "Vendor Name" and all "- Comments" columns)
const features: string[] = [];
for (let i = 1; i < headers.length; i++) {
  const header = headers[i];
  if (header && !header.includes(' - Comments')) {
    features.push(header.trim());
  }
}

console.log('=== FEATURES EXTRACTED ===');
console.log('Total features:', features.length);
console.log(JSON.stringify(features, null, 2));

// Group features into categories based on functionality
const featureCategories: Record<string, string[]> = {
  'Data Durability & Resilience': [
    'High Data Durability',
    'Multi-AZ Resilience:',
    'Multi-AZ data placement',
    'Erasure coding scheme',
    'Background scrubbing',
    'Geo-resilient (multi-region) class',
  ],
  'Performance & Scalability': [
    'Availability SLA',
    'Scalability',
    'Low-Latency Access:',
    'High Throughput:',
    'Concurrency',
    'Single-AZ "low-latency" class',
    'Large Object Support',
    'Multipart Upload',
  ],
  'Consistency & Data Integrity': [
    'Consistency',
    'Strong read-after-write (new objects)',
    'Overwrite/delete consistency',
    'LIST consistency',
  ],
  'Security & Encryption': [
    'Encryption at Rest:',
    'Encryption in Transit:',
    'External Key Management',
    'Identity & Access Management:',
    'Bucket/Object Policies:',
    'Network Isolation',
    'Regional isolation controls',
  ],
  'Compliance & Auditing': [
    'Certifications & Compliance:',
    'Audit Logging',
    'Audit & Access Logs',
  ],
  'Storage Management': [
    'Storage Tiering:',
    'Lifecycle Management:',
    'Object Metadata & Tagging',
    'Hierarchical Namespace (HNS)',
  ],
  'Monitoring & Operations': [
    'Usage Metrics',
    'Alerts and Monitoring Integration',
  ],
};

// Find remaining features not categorized
const categorizedFeatures = Object.values(featureCategories).flat();
const uncategorized = features.filter(f => !categorizedFeatures.includes(f));

if (uncategorized.length > 0) {
  featureCategories['Additional Capabilities'] = uncategorized;
}

console.log('\n=== FEATURE CATEGORIES ===');
for (const [category, feats] of Object.entries(featureCategories)) {
  console.log(`\n${category}: (${feats.length} features)`);
  feats.forEach(f => console.log(`  - ${f}`));
}

// Extract vendor data
console.log('\n=== VENDOR DATA ===');
const vendors: string[] = [];
for (let i = 1; i < productData.length; i++) {
  const row = productData[i];
  if (row && row[0]) {
    vendors.push(row[0] as string);
    console.log(`Vendor: ${row[0]}`);
  }
}

// Build feature-to-column mapping
const featureColumnMap: Record<string, { scoreCol: number; commentCol: number }> = {};
for (let i = 1; i < headers.length; i++) {
  const header = headers[i];
  if (header && !header.includes(' - Comments')) {
    const featureName = header.trim();
    featureColumnMap[featureName] = {
      scoreCol: i,
      commentCol: i + 1, // Next column is the comment
    };
  }
}

// Generate SQL statements
console.log('\n\n========================================');
console.log('=== SQL STATEMENTS FOR PRODUCTION ===');
console.log('========================================\n');

console.log('-- IMPORTANT: Replace {MARKET_ID} with your actual market ID');
console.log('-- Run this query first to get the market ID:');
console.log("-- SELECT id FROM markets WHERE name LIKE '%Public%Cloud%Object%Storage%';\n");

console.log('-- Step 1: Create Feature Categories');
let categoryOrder = 0;
for (const categoryName of Object.keys(featureCategories)) {
  categoryOrder++;
  console.log(`INSERT INTO feature_categories (id, name, description, market_id, display_order)`);
  console.log(`VALUES (gen_random_uuid(), '${categoryName.replace(/'/g, "''")}', 'Product evaluation category for ${categoryName.replace(/'/g, "''")}', '{MARKET_ID}', ${categoryOrder});`);
}

console.log('\n-- Step 2: Create Features (run after categories are created)');
console.log('-- Get category IDs first:');
console.log('-- SELECT id, name FROM feature_categories WHERE market_id = \'{MARKET_ID}\';');

console.log('\n-- Then insert features for each category:');
for (const [categoryName, feats] of Object.entries(featureCategories)) {
  console.log(`\n-- Features for "${categoryName}" category:`);
  let featureOrder = 0;
  for (const feature of feats) {
    featureOrder++;
    const escapedFeature = feature.replace(/'/g, "''").replace(/:/g, '');
    console.log(`INSERT INTO features (id, name, description, category_id, display_order)`);
    console.log(`SELECT gen_random_uuid(), '${escapedFeature}', NULL, fc.id, ${featureOrder}`);
    console.log(`FROM feature_categories fc WHERE fc.name = '${categoryName.replace(/'/g, "''")}' AND fc.market_id = '{MARKET_ID}';`);
  }
}

console.log('\n-- Step 3: Create Vendor Feature Support (Harvey Ball scores)');
console.log('-- Get vendor IDs first:');
console.log('-- SELECT id, name FROM vendors WHERE market_id = \'{MARKET_ID}\';');

// Create vendor support data
for (let vendorIdx = 1; vendorIdx < productData.length; vendorIdx++) {
  const row = productData[vendorIdx];
  if (!row || !row[0]) continue;
  
  const vendorName = (row[0] as string).trim();
  console.log(`\n-- Support data for "${vendorName}":`);
  
  for (const feature of features) {
    const colInfo = featureColumnMap[feature];
    if (!colInfo) continue;
    
    const score = row[colInfo.scoreCol];
    const comment = row[colInfo.commentCol] || '';
    
    if (score !== undefined && score !== null && score !== '') {
      const numScore = typeof score === 'number' ? score : parseInt(score as string);
      if (!isNaN(numScore) && numScore >= 0 && numScore <= 4) {
        const escapedFeature = feature.replace(/'/g, "''").replace(/:/g, '');
        const escapedComment = String(comment).substring(0, 2000).replace(/'/g, "''");
        
        console.log(`INSERT INTO vendor_feature_support (id, vendor_id, feature_id, support_level, comments)`);
        console.log(`SELECT gen_random_uuid(), v.id, f.id, ${numScore}, '${escapedComment}'`);
        console.log(`FROM vendors v, features f, feature_categories fc`);
        console.log(`WHERE v.name = '${vendorName.replace(/'/g, "''")}' AND v.market_id = '{MARKET_ID}'`);
        console.log(`AND f.name = '${escapedFeature}' AND f.category_id = fc.id AND fc.market_id = '{MARKET_ID}'`);
        console.log(`ON CONFLICT (vendor_id, feature_id) DO UPDATE SET support_level = ${numScore}, comments = EXCLUDED.comments;`);
      }
    }
  }
}

console.log('\n-- END OF SQL STATEMENTS');
