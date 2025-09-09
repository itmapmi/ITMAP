const API_BASE = 'http://localhost:5000';
const BACKUP_MARKET_ID = 'b9a22e91-6aef-4434-96f7-3222a9dc3d5e';

async function debugRansomwareData() {
    console.log('🔍 Debugging ransomware feature support data...\n');
    
    try {
        // Get features
        console.log('📋 Fetching features...');
        const featuresResponse = await fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/features`);
        const features = await featuresResponse.json();
        
        const ransomwareFeatures = features.filter(f => 
            f.category && f.category.name && 
            f.category.name.toLowerCase().includes('ransomware')
        );
        
        console.log(`Found ${ransomwareFeatures.length} ransomware features:`);
        ransomwareFeatures.forEach(f => {
            console.log(`  - ${f.name} (ID: ${f.id})`);
        });
        
        // Get feature support data
        console.log('\n📊 Fetching feature support data...');
        const supportResponse = await fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/feature-support`);
        const supportData = await supportResponse.json();
        
        // Filter for ransomware feature support
        const ransomwareSupport = supportData.filter(s => 
            ransomwareFeatures.some(f => f.id === s.featureId)
        );
        
        console.log(`Found ${ransomwareSupport.length} ransomware support records\n`);
        
        // Group by feature for display
        const supportByFeature = {};
        ransomwareSupport.forEach(s => {
            const feature = ransomwareFeatures.find(f => f.id === s.featureId);
            if (feature) {
                if (!supportByFeature[feature.name]) {
                    supportByFeature[feature.name] = [];
                }
                supportByFeature[feature.name].push(s);
            }
        });
        
        // Display current data
        for (const [featureName, supports] of Object.entries(supportByFeature)) {
            console.log(`📝 Feature: ${featureName}`);
            console.log(`   Records: ${supports.length}`);
            
            supports.slice(0, 3).forEach(s => {
                console.log(`   - Vendor ${s.vendorId}: Level ${s.supportLevel}`);
                console.log(`     Notes: "${s.notes ? s.notes.substring(0, 100) : 'No notes'}..."`);
            });
            
            if (supports.length > 3) {
                console.log(`   ... and ${supports.length - 3} more records`);
            }
            console.log();
        }
        
        // Get vendors for mapping
        console.log('👥 Fetching vendors...');
        const vendorsResponse = await fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/vendors`);
        const vendors = await vendorsResponse.json();
        
        const vendorMap = {};
        vendors.forEach(v => {
            vendorMap[v.id] = v.name;
        });
        
        // Display detailed view with vendor names
        console.log('\n📊 Detailed Support Data:');
        for (const [featureName, supports] of Object.entries(supportByFeature)) {
            console.log(`\n🎯 ${featureName}:`);
            supports.forEach(s => {
                const vendorName = vendorMap[s.vendorId] || 'Unknown';
                console.log(`   ${vendorName}: Score ${s.supportLevel}`);
                if (s.notes) {
                    console.log(`     Comment: "${s.notes.substring(0, 150)}..."`);
                } else {
                    console.log(`     ❌ No comment found!`);
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Error debugging data:', error);
    }
}

debugRansomwareData();