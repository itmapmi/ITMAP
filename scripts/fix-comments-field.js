import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '..', 'attached_assets', 'March24_with_questions (1)_1757443684303.xlsx');
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

function extractRatingAndComment(cellValue) {
    if (!cellValue || cellValue === '') {
        return { rating: 'none', score: 0, comment: '' };
    }

    const text = cellValue.toString().trim();
    const lowerText = text.toLowerCase();
    
    let foundRating = 'none';
    for (const [rating] of Object.entries(RATING_TO_SCORE)) {
        if (lowerText.includes(rating)) {
            foundRating = rating;
            break;
        }
    }
    
    const score = RATING_TO_SCORE[foundRating] || 0;
    
    return {
        rating: foundRating,
        score: score,
        comment: text 
    };
}

async function fixCommentsField() {
    console.log('🔧 Fixing comments field mapping...\n');

    try {
        // Read Excel file
        const workbook = XLSX.readFile(filePath);
        const sheetName = 'Ransomware Detection and Recove';
        const worksheet = workbook.Sheets[sheetName];
        
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        const headers = data[0];
        const vendorColumns = [];
        const vendorNames = [];
        
        for (let i = 2; i < headers.length; i++) {
            if (headers[i] && headers[i].toString().trim()) {
                vendorColumns.push(i);
                vendorNames.push(headers[i].toString().trim());
            }
        }

        // Get database data
        const [vendorsResp, featuresResp] = await Promise.all([
            fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/vendors`),
            fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/features`)
        ]);
        
        const vendors = await vendorsResp.json();
        const features = await featuresResp.json();
        
        const ransomwareFeatures = features.filter(f => 
            f.category?.name?.toLowerCase().includes('ransomware')
        );

        // Create lookup maps
        const vendorNameToId = new Map();
        vendors.forEach(v => {
            vendorNameToId.set(v.name.toLowerCase(), v.id);
        });

        const featureNameToId = new Map();
        ransomwareFeatures.forEach(f => {
            featureNameToId.set(f.name.toLowerCase(), f.id);
        });

        let successCount = 0;
        let errorCount = 0;

        // Process each feature
        for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
            const row = data[rowIndex];
            const featureName = row[0]?.toString().trim();
            
            if (!featureName) continue;
            
            const featureId = featureNameToId.get(featureName.toLowerCase());
            if (!featureId) continue;

            console.log(`\n📝 Processing: ${featureName}`);

            // Process each vendor
            for (let i = 0; i < vendorColumns.length; i++) {
                const colIndex = vendorColumns[i];
                const vendorName = vendorNames[i];
                const cellValue = row[colIndex];
                
                const vendorId = vendorNameToId.get(vendorName.toLowerCase());
                if (!vendorId) continue;

                const extracted = extractRatingAndComment(cellValue);
                
                console.log(`  ${vendorName}: ${extracted.score} - "${extracted.comment.substring(0, 80)}..."`);

                try {
                    // Use the correct field name 'comments' instead of 'notes'
                    const response = await fetch(`${API_BASE}/api/vendor-feature-support`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            vendorId: vendorId,
                            featureId: featureId,
                            supportLevel: extracted.score,
                            comments: extracted.comment  // Correct field name!
                        })
                    });

                    if (response.ok) {
                        successCount++;
                        console.log(`    ✅ Saved with comment`);
                    } else {
                        errorCount++;
                        console.log(`    ❌ Failed: ${response.status}`);
                    }
                } catch (error) {
                    errorCount++;
                    console.log(`    ❌ Error: ${error.message}`);
                }

                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log('🎉 Comments field fix completed!');
        console.log(`📊 Summary:`);
        console.log(`  ✅ Successful updates: ${successCount}`);
        console.log(`  ❌ Errors: ${errorCount}`);
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Error fixing comments field:', error);
    }
}

fixCommentsField();