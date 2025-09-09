import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the new Excel file
const filePath = path.join(__dirname, '..', 'attached_assets', 'March24_with_questions (1)_1757443684303.xlsx');

const API_BASE = 'http://localhost:5000';
const BACKUP_MARKET_ID = 'b9a22e91-6aef-4434-96f7-3222a9dc3d5e';

try {
    console.log('📊 Reading updated Excel file for Ransomware Detection scores...\n');
    const workbook = XLSX.readFile(filePath);
    console.log('Available sheets:', workbook.SheetNames);
    
    // Find the Ransomware Detection sheet
    const ransomwareSheetName = workbook.SheetNames.find(name => 
        name.toLowerCase().includes('ransomware') || 
        name.toLowerCase().includes('detection') ||
        name.toLowerCase().includes('recover')
    );
    
    if (!ransomwareSheetName) {
        console.log('❌ Could not find Ransomware Detection sheet');
        console.log('Available sheets:', workbook.SheetNames);
        process.exit(1);
    }
    
    console.log(`📋 Processing sheet: ${ransomwareSheetName}\n`);
    
    const worksheet = workbook.Sheets[ransomwareSheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
    
    if (data.length === 0) {
        console.log('❌ No data found in sheet');
        process.exit(1);
    }
    
    console.log('Headers found:', data[0]);
    console.log(`Total rows: ${data.length}\n`);
    
    // Extract vendor columns (skip Feature and Evaluation Criteria columns)
    const headers = data[0];
    const vendorColumns = [];
    const vendorNames = [];
    
    for (let i = 2; i < headers.length; i++) { // Skip first 2 columns (Feature, Evaluation Criteria)
        if (headers[i] && headers[i].toString().trim()) {
            vendorColumns.push(i);
            vendorNames.push(headers[i].toString().trim());
        }
    }
    
    console.log('Vendor columns found:', vendorNames);
    console.log();
    
    // Extract features and their scores
    const extractedData = [];
    
    for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
        const row = data[rowIndex];
        const featureName = row[0]?.toString().trim();
        const evaluationCriteria = row[1]?.toString().trim();
        
        if (!featureName || featureName === '') continue;
        
        console.log(`🔍 Processing feature: ${featureName}`);
        
        const vendorScores = {};
        
        // Extract scores for each vendor
        vendorColumns.forEach((colIndex, vendorIndex) => {
            const vendorName = vendorNames[vendorIndex];
            const cellValue = row[colIndex];
            
            // Extract numeric score (look for numbers 0-4)
            let score = 0;
            let notes = '';
            
            if (cellValue !== undefined && cellValue !== null && cellValue !== '') {
                const cellStr = cellValue.toString().trim();
                
                // Try to extract score from various formats
                const scoreMatch = cellStr.match(/[0-4]/);
                if (scoreMatch) {
                    score = parseInt(scoreMatch[0]);
                }
                
                // Everything else as notes/commentary
                notes = cellStr.replace(/^[0-4]\s*-?\s*/, '').trim();
                
                console.log(`  ${vendorName}: Score ${score}${notes ? ` (${notes.substring(0, 50)}...)` : ''}`);
            }
            
            vendorScores[vendorName] = {
                score: score,
                notes: notes,
                evaluationCriteria: evaluationCriteria
            };
        });
        
        extractedData.push({
            featureName: featureName,
            evaluationCriteria: evaluationCriteria,
            vendorScores: vendorScores
        });
    }
    
    // Save extracted data for review
    const outputPath = path.join(__dirname, 'ransomware-scores-extracted.json');
    fs.writeFileSync(outputPath, JSON.stringify(extractedData, null, 2));
    
    console.log(`\n✅ Data extraction complete!`);
    console.log(`📄 Data saved to: ${outputPath}`);
    console.log(`📊 Features processed: ${extractedData.length}`);
    console.log(`👥 Vendors found: ${vendorNames.length}`);
    
    // Now update the database with the extracted scores
    await updateScoresInDatabase(extractedData, vendorNames);
    
} catch (error) {
    console.error('❌ Error processing Excel file:', error);
    
    // Try to provide more details about the file
    try {
        const stats = fs.statSync(filePath);
        console.log('File exists, size:', stats.size, 'bytes');
    } catch (e) {
        console.log('File does not exist at:', filePath);
    }
}

async function updateScoresInDatabase(featuresData, vendorNames) {
    console.log('\n🔄 Updating scores in database...\n');
    
    try {
        // First, get existing vendors and features for the backup market
        console.log('📋 Fetching existing data...');
        
        const vendorsResponse = await fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/vendors`);
        const vendors = await vendorsResponse.json();
        console.log(`Found ${vendors.length} vendors in database`);
        
        const featuresResponse = await fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/features`);
        const features = await featuresResponse.json();
        console.log(`Found ${features.length} features in database`);
        
        // Filter for ransomware category features
        const ransomwareFeatures = features.filter(f => 
            f.category && f.category.name && 
            f.category.name.toLowerCase().includes('ransomware')
        );
        console.log(`Found ${ransomwareFeatures.length} ransomware features`);
        
        // Create lookup maps
        const vendorNameMap = new Map();
        vendors.forEach(v => {
            vendorNameMap.set(v.name.toLowerCase(), v.id);
        });
        
        const featureNameMap = new Map();
        ransomwareFeatures.forEach(f => {
            featureNameMap.set(f.name.toLowerCase(), f.id);
        });
        
        let updateCount = 0;
        let errorCount = 0;
        
        // Update scores for each feature
        for (const featureData of featuresData) {
            const featureId = featureNameMap.get(featureData.featureName.toLowerCase());
            
            if (!featureId) {
                console.log(`⚠️  Feature not found in database: ${featureData.featureName}`);
                continue;
            }
            
            console.log(`\n📝 Updating feature: ${featureData.featureName}`);
            
            // Update scores for each vendor
            for (const [vendorName, scoreData] of Object.entries(featureData.vendorScores)) {
                const vendorId = vendorNameMap.get(vendorName.toLowerCase());
                
                if (!vendorId) {
                    console.log(`  ⚠️  Vendor not found: ${vendorName}`);
                    continue;
                }
                
                try {
                    const response = await fetch(`${API_BASE}/api/vendor-feature-support`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            vendorId: vendorId,
                            featureId: featureId,
                            supportLevel: scoreData.score,
                            notes: scoreData.notes || ''
                        })
                    });
                    
                    if (response.ok) {
                        updateCount++;
                        console.log(`  ✅ ${vendorName}: Score ${scoreData.score}`);
                    } else {
                        errorCount++;
                        const error = await response.text();
                        console.log(`  ❌ Failed to update ${vendorName}: ${error}`);
                    }
                    
                    // Small delay to avoid overwhelming the API
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (error) {
                    errorCount++;
                    console.log(`  ❌ Error updating ${vendorName}: ${error.message}`);
                }
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 Score update completed!');
        console.log(`📊 Summary:`);
        console.log(`  Updates successful: ${updateCount}`);
        if (errorCount > 0) {
            console.log(`  Errors: ${errorCount}`);
        }
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Error updating database:', error);
    }
}