import fetch from 'node-fetch';

const API_BASE = 'http://localhost:5000';
const BACKUP_MARKET_ID = 'b9a22e91-6aef-4434-96f7-3222a9dc3d5e';
const PRODUCT_CAPABILITIES_CRITERIA_ID = '6a358cb9-3a2a-4c39-8d93-01164a6cf57c';

async function updateProductCapabilitiesScores() {
    console.log('🔄 Updating Product Capabilities scores from Support Matrix...\n');

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

        // Filter features to EXCLUDE ecosystem-related categories (only product capabilities)
        const productCapabilityFeatures = allFeatures.filter(feature => 
            !feature.category.name.toLowerCase().includes('ecosystem') &&
            !feature.category.name.toLowerCase().includes('integration') &&
            !feature.category.name.toLowerCase().includes('partnership') &&
            !feature.category.name.toLowerCase().includes('third-party')
        );

        console.log(`📊 Found ${productCapabilityFeatures.length} product capability features (excluding ecosystem features)`);
        console.log(`🏢 Found ${allVendors.length} vendors\n`);

        // Group features by category to show breakdown
        const featuresByCategory = productCapabilityFeatures.reduce((acc, feature) => {
            const categoryName = feature.category.name;
            if (!acc[categoryName]) {
                acc[categoryName] = [];
            }
            acc[categoryName].push(feature.name);
            return acc;
        }, {});

        console.log('📋 Product capability categories:');
        Object.entries(featuresByCategory).forEach(([category, features]) => {
            console.log(`  ${category}: ${features.length} features`);
        });
        console.log('');

        // Create support lookup map
        const supportLookup = new Map();
        supportMatrix.forEach(support => {
            const key = `${support.vendorId}-${support.featureId}`;
            supportLookup.set(key, support.supportLevel);
        });

        // Calculate product capability scores for each vendor (same logic as Support Matrix)
        const vendorProductScores = {};
        
        allVendors.forEach(vendor => {
            let totalScore = 0;
            let maxScore = 0;
            
            productCapabilityFeatures.forEach(feature => {
                const supportKey = `${vendor.id}-${feature.id}`;
                const level = supportLookup.get(supportKey) || 0;
                
                // Convert support level to score (same as Support Matrix component)
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
            
            vendorProductScores[vendor.id] = {
                vendorName: vendor.name,
                totalScore: Number(totalScore.toFixed(2)),
                maxScore,
                normalizedScore: Number(normalizedScore.toFixed(2))
            };
        });

        console.log('📊 Calculated product capability scores:');
        Object.values(vendorProductScores).forEach(score => {
            console.log(`  ${score.vendorName}: ${score.normalizedScore}/10 (${score.totalScore}/${score.maxScore})`);
        });

        // Update Product Capabilities scores for each vendor
        console.log('\n🔄 Updating Product Capabilities scores...');
        let successCount = 0;
        let errorCount = 0;

        for (const vendor of allVendors) {
            const productScore = vendorProductScores[vendor.id];
            if (!productScore) {
                console.log(`⚠️ No product score calculated for ${vendor.name}`);
                continue;
            }

            try {
                const response = await fetch(`${API_BASE}/api/vendor-scores`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        vendorId: vendor.id,
                        criteriaId: PRODUCT_CAPABILITIES_CRITERIA_ID,
                        score: productScore.normalizedScore
                    })
                });

                if (response.ok) {
                    successCount++;
                    console.log(`  ✅ ${vendor.name}: Updated Product Capabilities score to ${productScore.normalizedScore}`);
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
        console.log('🎯 Product Capabilities Score Update Complete!');
        console.log(`📊 Summary:`);
        console.log(`  🏢 Vendors processed: ${allVendors.length}`);
        console.log(`  ✅ Successful updates: ${successCount}`);
        console.log(`  ❌ Errors: ${errorCount}`);
        console.log(`  🔧 Product capability features used: ${productCapabilityFeatures.length}`);
        console.log(`  🚫 Ecosystem features excluded: ${allFeatures.length - productCapabilityFeatures.length}`);
        console.log('='.repeat(80));

    } catch (error) {
        console.error('❌ Error updating Product Capabilities scores:', error);
    }
}

updateProductCapabilitiesScores();