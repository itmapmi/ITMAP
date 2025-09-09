import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const API_BASE = 'http://localhost:5000';
const BACKUP_MARKET_ID = 'b9a22e91-6aef-4434-96f7-3222a9dc3d5e';

// Mapping from text ratings to Harvey Ball scores
const RATING_TO_SCORE = {
    'none': 0,
    'limited': 1,
    'partial': 2,
    'good': 3,
    'full': 4,
    'full support': 4
};

function convertRatingToScore(rating) {
    if (!rating || typeof rating !== 'string') return 0;
    
    const cleanRating = rating.toLowerCase().trim();
    return RATING_TO_SCORE[cleanRating] ?? 0;
}

async function fixRansomwareScores() {
    console.log('🔧 Fixing ransomware detection scores with proper Harvey Ball mapping...\n');
    
    try {
        // Read the extracted data
        const dataPath = path.join(__dirname, 'ransomware-scores-extracted.json');
        const extractedData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        
        // Get existing data from API
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
        
        console.log('\n🎯 Converting text ratings to Harvey Ball scores:\n');
        
        // Process each feature
        for (const featureData of extractedData) {
            const featureId = featureNameMap.get(featureData.featureName.toLowerCase());
            
            if (!featureId) {
                console.log(`⚠️  Feature not found in database: ${featureData.featureName}`);
                continue;
            }
            
            console.log(`📝 Updating feature: ${featureData.featureName}`);
            console.log(`   Criteria: ${featureData.evaluationCriteria.substring(0, 100)}...`);
            
            // Update scores for each vendor with proper mapping
            for (const [vendorName, scoreData] of Object.entries(featureData.vendorScores)) {
                const vendorId = vendorNameMap.get(vendorName.toLowerCase());
                
                if (!vendorId) {
                    console.log(`  ⚠️  Vendor not found: ${vendorName}`);
                    continue;
                }
                
                // Convert text rating to numeric score
                const textRating = scoreData.notes || '';
                const numericScore = convertRatingToScore(textRating);
                
                try {
                    const response = await fetch(`${API_BASE}/api/vendor-feature-support`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            vendorId: vendorId,
                            featureId: featureId,
                            supportLevel: numericScore,
                            notes: `${textRating} - ${scoreData.evaluationCriteria.substring(0, 200)}...`
                        })
                    });
                    
                    if (response.ok) {
                        updateCount++;
                        console.log(`  ✅ ${vendorName}: "${textRating}" → Score ${numericScore}`);
                    } else {
                        errorCount++;
                        const error = await response.text();
                        console.log(`  ❌ Failed to update ${vendorName}: ${error}`);
                    }
                    
                    // Small delay to avoid overwhelming the API
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                } catch (error) {
                    errorCount++;
                    console.log(`  ❌ Error updating ${vendorName}: ${error.message}`);
                }
            }
            
            console.log(); // Empty line for readability
        }
        
        // Display rating conversion summary
        console.log('📊 Rating Conversion Summary:');
        const ratingCounts = {};
        extractedData.forEach(feature => {
            Object.values(feature.vendorScores).forEach(scoreData => {
                const rating = scoreData.notes || 'none';
                ratingCounts[rating] = (ratingCounts[rating] || 0) + 1;
            });
        });
        
        Object.entries(ratingCounts).sort().forEach(([rating, count]) => {
            const score = convertRatingToScore(rating);
            console.log(`  "${rating}" (Score ${score}): ${count} occurrences`);
        });
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 Score correction completed!');
        console.log(`📊 Summary:`);
        console.log(`  Updates successful: ${updateCount}`);
        if (errorCount > 0) {
            console.log(`  Errors: ${errorCount}`);
        }
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Error fixing scores:', error);
    }
}

// Run the fix
fixRansomwareScores();