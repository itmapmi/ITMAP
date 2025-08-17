import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Harvey Ball to numeric mapping
const harveyBallMap = {
  '●': 4, // Full
  '◕': 3, // Good
  '◑': 2, // Partial
  '◔': 1, // Limited
  '○': 0  // None
};

// Read the Excel file
const filePath = path.join(__dirname, 'attached_assets', 'high_end_storage_support_matrix_fs9500_1755435481069.xlsx');
const workbook = XLSX.readFile(filePath);
const worksheet = workbook.Sheets[workbook.SheetNames[0]];
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

// Extract IBM scores
const ibmScores = [];
const ecosystemScores = [];
const productCapabilityScores = [];

data.forEach((row, index) => {
  if (row && row.length >= 3 && row.some(cell => cell && cell.toString().toLowerCase().includes('ibm'))) {
    const category = row[0];
    const feature = row[1];
    const harveyBall = row[2];
    const score = harveyBallMap[harveyBall] || 0;
    
    const scoreData = {
      category,
      feature,
      harveyBall,
      score,
      rowIndex: index
    };
    
    ibmScores.push(scoreData);
    
    // Categorize into ecosystem vs product capabilities
    if (category === 'Ecosystem Support') {
      ecosystemScores.push(scoreData);
    } else {
      productCapabilityScores.push(scoreData);
    }
  }
});

console.log('=== IBM HARVEY BALL SCORES ===\n');
console.log(`Total IBM features found: ${ibmScores.length}`);
console.log(`Ecosystem Support features: ${ecosystemScores.length}`);
console.log(`Product Capability features: ${productCapabilityScores.length}\n`);

// Calculate ecosystem score
const ecosystemTotal = ecosystemScores.reduce((sum, item) => sum + item.score, 0);
const ecosystemNormalized = ((ecosystemTotal / (ecosystemScores.length * 4)) * 10).toFixed(2);

console.log('=== ECOSYSTEM SUPPORT CALCULATION ===');
console.log(`Total ecosystem score: ${ecosystemTotal}/${ecosystemScores.length * 4}`);
console.log(`Normalized ecosystem score (0-10): ${ecosystemNormalized}\n`);

// Calculate product capabilities score
const productTotal = productCapabilityScores.reduce((sum, item) => sum + item.score, 0);
const productNormalized = ((productTotal / (productCapabilityScores.length * 4)) * 10).toFixed(2);

console.log('=== PRODUCT CAPABILITIES CALCULATION ===');
console.log(`Total product score: ${productTotal}/${productCapabilityScores.length * 4}`);
console.log(`Normalized product score (0-10): ${productNormalized}\n`);

// Show detailed breakdown by category
console.log('=== DETAILED BREAKDOWN ===');
const categoryBreakdown = {};
ibmScores.forEach(item => {
  if (!categoryBreakdown[item.category]) {
    categoryBreakdown[item.category] = { total: 0, count: 0, features: [] };
  }
  categoryBreakdown[item.category].total += item.score;
  categoryBreakdown[item.category].count += 1;
  categoryBreakdown[item.category].features.push({
    feature: item.feature,
    harveyBall: item.harveyBall,
    score: item.score
  });
});

Object.keys(categoryBreakdown).forEach(category => {
  const data = categoryBreakdown[category];
  const avg = (data.total / data.count).toFixed(2);
  const normalized = ((data.total / (data.count * 4)) * 10).toFixed(2);
  console.log(`\n${category}:`);
  console.log(`  Features: ${data.count}`);
  console.log(`  Total score: ${data.total}/${data.count * 4}`);
  console.log(`  Average: ${avg}/4`);
  console.log(`  Normalized (0-10): ${normalized}`);
});

// Generate SQL update statements
console.log('\n=== SQL UPDATE STATEMENTS ===');
console.log('\n-- Individual feature updates:');
ibmScores.forEach(item => {
  console.log(`UPDATE vendor_feature_support SET support_level = ${item.score} WHERE vendor_id = (SELECT id FROM vendors WHERE name = 'IBM' AND market_id = '15a29a79-b10f-44ad-9aff-1685adb6f4ea') AND feature_id = (SELECT id FROM features WHERE name = '${item.feature.replace(/'/g, "''")}');`);
});

console.log('\n-- Update ISV Ecosystem score:');
console.log(`UPDATE vendor_scores SET score = ${ecosystemNormalized} WHERE vendor_id = (SELECT id FROM vendors WHERE name = 'IBM' AND market_id = '15a29a79-b10f-44ad-9aff-1685adb6f4ea') AND criteria_id = (SELECT id FROM criteria WHERE name = 'ISV Ecosystem');`);

console.log('\n-- Update Product Capabilities score:');
console.log(`UPDATE vendor_scores SET score = ${productNormalized} WHERE vendor_id = (SELECT id FROM vendors WHERE name = 'IBM' AND market_id = '15a29a79-b10f-44ad-9aff-1685adb6f4ea') AND criteria_id = (SELECT id FROM criteria WHERE name = 'Product Capabilities');`);