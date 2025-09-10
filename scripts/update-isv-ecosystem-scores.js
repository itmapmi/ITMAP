import fetch from 'node-fetch';

const API_BASE = 'http://localhost:5000';
const BACKUP_MARKET_ID = 'b9a22e91-6aef-4434-96f7-3222a9dc3d5e';
const ISV_ECOSYSTEM_CRITERIA_ID = 'd3d295f1-c8d4-49d2-a77b-42bc68889652';

async function updateISVEcosystemScores() {
    console.log('🔄 Updating ISV Ecosystem scores from calculated ecosystem support...\n');

    try {
        // Get data from API endpoints
        const [vendorsResp, featuresResp, supportResp] = await Promise.all([
            fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/vendors`),
            fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/features`),
            fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/feature-support`)
        ]);

        const allVendors = await vendorsResp.json();
        const allFeatures = await featuresResp.json();
        const supportMatrix = await supportResp.json();

        // Filter features to only include ecosystem-related categories
        const ecosystemFeatures = allFeatures.filter(feature => 
            feature.category.name.toLowerCase().includes('ecosystem') ||
            feature.category.name.toLowerCase().includes('integration') ||
            feature.category.name.toLowerCase().includes('partnership') ||
            feature.category.name.toLowerCase().includes('third-party')
        );

        console.log(`📊 Found ${ecosystemFeatures.length} ecosystem features:`);
        ecosystemFeatures.forEach(f => console.log(`  - ${f.name} (${f.category.name})`));
        console.log(`🏢 Found ${allVendors.length} vendors\n`);

        // Create support lookup map
        const supportLookup = new Map();
        supportMatrix.forEach(support => {
            const key = `${support.vendorId}-${support.featureId}`;
            supportLookup.set(key, support.supportLevel);
        });

        // Calculate ecosystem support scores for each vendor (same logic as ecosystem component)
        const vendorEcosystemScores = {};
        
        allVendors.forEach(vendor => {
            let totalScore = 0;
            let maxScore = 0;
            
            ecosystemFeatures.forEach(feature => {
                const supportKey = `${vendor.id}-${feature.id}`;
                const level = supportLookup.get(supportKey) || 0;
                
                // Convert support level to score (same as ecosystem component)
                let score = 0;
                switch (level) {
                    case 4: score = 1.0; break;    // Full support
                    case 3: score = 0.75; break;   // Good support  
                    case 2: score = 0.5; break;    // Partial support
                    case 1: score = 0; break;      // Limited support
                    case 0: score = 0; break;      // No support
                }
                
                totalScore += score;
                maxScore += 1.0;
            });
            
            // Calculate normalized score out of 10
            const normalizedScore = maxScore > 0 ? (totalScore / maxScore) * 10 : 0;
            
            vendorEcosystemScores[vendor.id] = {
                vendorName: vendor.name,
                totalScore: Number(totalScore.toFixed(2)),
                maxScore,
                normalizedScore: Number(normalizedScore.toFixed(2))
            };
        });

        console.log('📊 Calculated ecosystem scores:');
        Object.values(vendorEcosystemScores).forEach(score => {
            console.log(`  ${score.vendorName}: ${score.normalizedScore}/10 (${score.totalScore}/${score.maxScore})`);
        });

        // Update ISV Ecosystem scores for each vendor
        console.log('\n🔄 Updating ISV Ecosystem scores...');
        let successCount = 0;
        let errorCount = 0;

        for (const vendor of allVendors) {
            const ecosystemScore = vendorEcosystemScores[vendor.id];
            if (!ecosystemScore) {
                console.log(`⚠️ No ecosystem score calculated for ${vendor.name}`);
                continue;
            }

            try {
                const response = await fetch(`${API_BASE}/api/vendor-scores`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        vendorId: vendor.id,
                        criteriaId: ISV_ECOSYSTEM_CRITERIA_ID,
                        score: ecosystemScore.normalizedScore
                    })
                });

                if (response.ok) {
                    successCount++;
                    console.log(`  ✅ ${vendor.name}: Updated ISV Ecosystem score to ${ecosystemScore.normalizedScore}`);
                } else {
                    errorCount++;
                    console.log(`  ❌ ${vendor.name}: Failed to update (${response.status})`);
                }
            } catch (error) {
                errorCount++;
                console.log(`  ❌ ${vendor.name}: Error - ${error.message}`);
            }

            // Small delay to avoid overwhelming the API
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        console.log('\n' + '='.repeat(80));
        console.log('🎯 ISV Ecosystem Score Update Complete!');
        console.log(`📊 Summary:`);
        console.log(`  🏢 Vendors processed: ${allVendors.length}`);
        console.log(`  ✅ Successful updates: ${successCount}`);
        console.log(`  ❌ Errors: ${errorCount}`);
        console.log(`  🔗 Ecosystem features used: ${ecosystemFeatures.length}`);
        console.log('='.repeat(80));

    } catch (error) {
        console.error('❌ Error updating ISV Ecosystem scores:', error);
    }
}

updateISVEcosystemScores();