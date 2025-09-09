import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '..', 'attached_assets', 'March24_with_questions (2)_1757445565460.xlsx');
const API_BASE = 'http://localhost:5000';
const BACKUP_MARKET_ID = 'b9a22e91-6aef-4434-96f7-3222a9dc3d5e';

// Harvey Ball score mapping
const RATING_TO_SCORE = {
    'none': 0,
    'limited': 1, 
    'partial': 2,
    'good': 3,
    'full': 4
};

async function processAIExcel() {
    console.log('🤖 Processing AI category Excel data...\n');

    try {
        // Read Excel file with cell comments
        const workbook = XLSX.readFile(filePath, { cellStyles: true, cellNF: true });
        
        console.log('📋 Available sheets:', workbook.SheetNames);
        
        // Look for AI-related sheet
        const aiSheet = workbook.SheetNames.find(name => 
            name.toLowerCase().includes('ai') || 
            name.toLowerCase().includes('artificial') ||
            name.toLowerCase().includes('intelligence')
        );
        
        if (!aiSheet) {
            console.log('❌ No AI-related sheet found. Available sheets:');
            workbook.SheetNames.forEach(name => console.log(`  - ${name}`));
            return;
        }
        
        console.log(`🎯 Processing sheet: ${aiSheet}\n`);
        
        const worksheet = workbook.Sheets[aiSheet];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        console.log(`📊 Sheet contains ${data.length} rows`);
        
        // Analyze sheet structure
        const headers = data[0];
        console.log(`📋 Headers found: ${headers.length}`);
        headers.forEach((header, idx) => {
            if (header && header.toString().trim()) {
                console.log(`  Column ${idx}: "${header}"`);
            }
        });
        
        // Find vendor columns (typically start from column 2 or 3)
        const vendorColumns = [];
        const vendorNames = [];
        
        for (let i = 2; i < headers.length; i++) {
            if (headers[i] && headers[i].toString().trim()) {
                vendorColumns.push(i);
                vendorNames.push(headers[i].toString().trim());
            }
        }
        
        console.log(`\n🏢 Found ${vendorNames.length} vendors:`);
        vendorNames.forEach(name => console.log(`  - ${name}`));
        
        // Analyze features (rows)
        console.log(`\n🎯 Features found:`);
        const features = [];
        for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
            const row = data[rowIndex];
            const featureName = row[0]?.toString().trim();
            
            if (featureName) {
                features.push({
                    name: featureName,
                    rowIndex: rowIndex
                });
                console.log(`  Row ${rowIndex + 1}: ${featureName}`);
            }
        }
        
        console.log(`\n📝 Analyzing cell comments and values...\n`);
        
        // Get database data for comparison
        const [vendorsResp, featuresResp] = await Promise.all([
            fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/vendors`),
            fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/features`)
        ]);
        
        const dbVendors = await vendorsResp.json();
        const dbFeatures = await featuresResp.json();
        
        // Find AI category features
        const aiFeatures = dbFeatures.filter(f => 
            f.category?.name?.toLowerCase().includes('artificial') ||
            f.category?.name?.toLowerCase().includes('intelligence') ||
            f.category?.name?.toLowerCase().includes('ai')
        );
        
        console.log(`🤖 AI features in database: ${aiFeatures.length}`);
        aiFeatures.forEach(f => console.log(`  - ${f.name} (Category: ${f.category?.name})`));
        
        // Create vendor lookup
        const vendorNameToId = new Map();
        dbVendors.forEach(v => {
            vendorNameToId.set(v.name.toLowerCase(), v.id);
        });
        
        const featureNameToId = new Map();
        aiFeatures.forEach(f => {
            featureNameToId.set(f.name.toLowerCase(), f.id);
        });
        
        // Extract data and comments for each feature
        let totalUpdates = 0;
        let successCount = 0;
        let errorCount = 0;
        let commentsFound = 0;
        
        for (const feature of features) {
            const featureId = featureNameToId.get(feature.name.toLowerCase());
            if (!featureId) {
                console.log(`⚠️ Feature not found in AI category: ${feature.name}`);
                continue;
            }
            
            console.log(`\n📝 Processing: ${feature.name}`);
            
            // Process each vendor column
            for (let i = 0; i < vendorColumns.length; i++) {
                const colIndex = vendorColumns[i];
                const vendorName = vendorNames[i];
                
                const vendorId = vendorNameToId.get(vendorName.toLowerCase());
                if (!vendorId) {
                    console.log(`  ⚠️ Vendor not found: ${vendorName}`);
                    continue;
                }
                
                // Get cell data and comments
                const cellAddress = XLSX.utils.encode_cell({ c: colIndex, r: feature.rowIndex });
                const cell = worksheet[cellAddress];
                
                if (!cell) {
                    console.log(`  📝 ${vendorName}: No data`);
                    continue;
                }
                
                const rating = cell.v?.toString().trim().toLowerCase() || 'none';
                const score = RATING_TO_SCORE[rating] || 0;
                
                let detailedComment = rating; // Default to rating
                
                // Check for Excel cell comments
                if (cell.c && cell.c.length > 0) {
                    detailedComment = cell.c.map(comment => comment.t).join(' ');
                    commentsFound++;
                    console.log(`  📝 ${vendorName}: ${rating} (${score}) + detailed comment`);
                    console.log(`      "${detailedComment.substring(0, 120)}..."`);
                } else {
                    console.log(`  📝 ${vendorName}: ${rating} (${score}) - basic rating only`);
                }
                
                totalUpdates++;
                
                try {
                    const response = await fetch(`${API_BASE}/api/vendor-feature-support`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            vendorId: vendorId,
                            featureId: featureId,
                            supportLevel: score,
                            comments: detailedComment
                        })
                    });

                    if (response.ok) {
                        successCount++;
                        console.log(`    ✅ Updated successfully`);
                    } else {
                        errorCount++;
                        console.log(`    ❌ Failed: ${response.status}`);
                    }
                } catch (error) {
                    errorCount++;
                    console.log(`    ❌ Error: ${error.message}`);
                }

                // Small delay to avoid overwhelming the API
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🤖 AI category update completed!');
        console.log(`📊 Summary:`);
        console.log(`  📝 Total updates attempted: ${totalUpdates}`);
        console.log(`  ✅ Successful updates: ${successCount}`);
        console.log(`  💬 Detailed comments found: ${commentsFound}`);
        console.log(`  ❌ Errors: ${errorCount}`);
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Error processing AI Excel data:', error);
    }
}

processAIExcel();