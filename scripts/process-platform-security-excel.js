import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '..', 'attached_assets', 'March24_with_questions_ecosystem_updated_platformsecurity_complete_1757487346296.xlsx');
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

async function updatePlatformSecurity() {
    console.log('🔐 Platform Security Excel processing...\n');

    try {
        // Read Excel file with cell comments
        const workbook = XLSX.readFile(filePath, { cellStyles: true, cellNF: true });
        const worksheet = workbook.Sheets['Platform Security'];
        
        if (!worksheet) {
            console.log('❌ Platform Security sheet not found');
            console.log('Available sheets:', Object.keys(workbook.Sheets));
            return;
        }
        
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
        
        // Get database data
        const [vendorsResp, featuresResp] = await Promise.all([
            fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/vendors`),
            fetch(`${API_BASE}/api/markets/${BACKUP_MARKET_ID}/features`)
        ]);
        
        const dbVendors = await vendorsResp.json();
        const dbFeatures = await featuresResp.json();
        
        // Filter Platform Security features
        const platformSecurityFeatures = dbFeatures.filter(f => 
            f.category?.name?.toLowerCase().includes('platform') && 
            f.category?.name?.toLowerCase().includes('security')
        );
        
        console.log(`📊 Found ${platformSecurityFeatures.length} Platform Security features in database`);
        
        if (platformSecurityFeatures.length === 0) {
            console.log('⚠️ No Platform Security features found. Checking for broader matches...');
            const securityFeatures = dbFeatures.filter(f => 
                f.category?.name?.toLowerCase().includes('security')
            );
            console.log(`Found ${securityFeatures.length} Security-related features:`);
            securityFeatures.forEach(f => console.log(`  - ${f.name} (${f.category.name})`));
            return;
        }
        
        // Create lookup maps
        const vendorNameToId = new Map();
        dbVendors.forEach(v => {
            vendorNameToId.set(v.name.toLowerCase().trim(), v.id);
        });
        
        const featureNameToId = new Map();
        platformSecurityFeatures.forEach(f => {
            featureNameToId.set(f.name.toLowerCase().trim(), f.id);
        });
        
        // Find vendor columns (typically start from column 2)
        const headers = data[0];
        const vendorColumns = [];
        const vendorNames = [];
        
        for (let i = 2; i < headers.length; i++) {
            if (headers[i] && headers[i].toString().trim()) {
                vendorColumns.push(i);
                vendorNames.push(headers[i].toString().trim());
            }
        }
        
        console.log(`🏢 Processing ${vendorNames.length} vendors: ${vendorNames.join(', ')}`);
        
        // Collect all updates first
        const updates = [];
        let featuresProcessed = 0;
        
        // Process each row (feature)
        for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
            const row = data[rowIndex];
            const featureName = row[0]?.toString().trim();
            
            if (!featureName || featureName.length < 3) continue;
            
            const featureId = featureNameToId.get(featureName.toLowerCase().trim());
            if (!featureId) {
                console.log(`⚠️ Platform Security feature not found: ${featureName}`);
                continue;
            }
            
            featuresProcessed++;
            console.log(`🔒 Processing Platform Security feature ${featuresProcessed}: ${featureName}`);
            
            // Process each vendor column
            for (let i = 0; i < vendorColumns.length; i++) {
                const colIndex = vendorColumns[i];
                const vendorName = vendorNames[i];
                
                const vendorId = vendorNameToId.get(vendorName.toLowerCase().trim());
                if (!vendorId) {
                    console.log(`  ⚠️ Vendor not found: ${vendorName}`);
                    continue;
                }
                
                // Get cell data and comments
                const cellAddress = XLSX.utils.encode_cell({ c: colIndex, r: rowIndex });
                const cell = worksheet[cellAddress];
                
                if (!cell || !cell.v) continue;
                
                const rating = cell.v.toString().trim().toLowerCase();
                const score = RATING_TO_SCORE[rating] || 0;
                
                let detailedComment = rating;
                
                // Check for Excel cell comments
                if (cell.c && cell.c.length > 0) {
                    detailedComment = cell.c.map(comment => comment.t).join(' ');
                }
                
                updates.push({
                    vendorId,
                    featureId,
                    supportLevel: score,
                    comments: detailedComment,
                    vendorName,
                    featureName,
                    rating
                });
            }
        }
        
        console.log(`\n📊 Total Platform Security updates to process: ${updates.length}`);
        console.log(`🔒 Features processed: ${featuresProcessed}`);
        
        // Process updates in batches to avoid timeouts
        const batchSize = 20;
        let successCount = 0;
        let errorCount = 0;
        
        for (let i = 0; i < updates.length; i += batchSize) {
            const batch = updates.slice(i, i + batchSize);
            console.log(`\n📦 Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(updates.length/batchSize)} (${batch.length} updates)`);
            
            // Process batch with concurrent requests
            const batchPromises = batch.map(async (update) => {
                try {
                    const response = await fetch(`${API_BASE}/api/vendor-feature-support`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(update)
                    });
                    
                    if (response.ok) {
                        successCount++;
                        return { success: true, update };
                    } else {
                        errorCount++;
                        return { success: false, update, error: response.status };
                    }
                } catch (error) {
                    errorCount++;
                    return { success: false, update, error: error.message };
                }
            });
            
            const results = await Promise.all(batchPromises);
            
            // Log results for this batch
            results.forEach(result => {
                if (result.success) {
                    console.log(`  ✅ ${result.update.vendorName} - ${result.update.featureName}: ${result.update.rating} (${result.update.supportLevel})`);
                } else {
                    console.log(`  ❌ ${result.update.vendorName} - ${result.update.featureName}: Error ${result.error}`);
                }
            });
            
            // Small delay between batches
            await new Promise(resolve => setTimeout(resolve, 500));
        }
        
        console.log('\n' + '='.repeat(80));
        console.log('🔐 Platform Security update completed!');
        console.log(`📊 Final Summary:`);
        console.log(`  📝 Total updates attempted: ${updates.length}`);
        console.log(`  ✅ Successful updates: ${successCount}`);
        console.log(`  ❌ Errors: ${errorCount}`);
        console.log(`  🔒 Platform Security features processed: ${featuresProcessed}`);
        console.log(`  🏢 Vendors processed: ${vendorNames.length}`);
        console.log('='.repeat(80));
        
    } catch (error) {
        console.error('❌ Error in Platform Security update:', error);
    }
}

updatePlatformSecurity();