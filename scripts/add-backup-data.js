import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the extracted data
const dataPath = path.join(__dirname, 'extracted-backup-data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const API_BASE = 'http://localhost:5000';
const BACKUP_MARKET_ID = 'b9a22e91-6aef-4434-96f7-3222a9dc3d5e'; // Backup Solutions market

async function addCategoriesAndFeatures() {
    console.log('🔄 Adding backup solution data to admin portal...\n');
    console.log(`📍 Target market: Backup Solutions (${BACKUP_MARKET_ID})\n`);
    
    try {
        // First, add all feature categories
        console.log('📁 Adding feature categories...');
        const categoryIdMap = new Map();
        
        for (const category of data.categories) {
            console.log(`  Creating category: ${category.name}`);
            
            const response = await fetch(`${API_BASE}/api/feature-categories`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    name: category.name,
                    description: category.description,
                    marketId: BACKUP_MARKET_ID,
                    displayOrder: category.displayOrder
                })
            });
            
            if (response.ok) {
                const createdCategory = await response.json();
                categoryIdMap.set(category.name, createdCategory.id);
                console.log(`    ✅ Created: ${category.name} (ID: ${createdCategory.id})`);
            } else {
                const error = await response.text();
                console.log(`    ❌ Failed to create ${category.name}: ${error}`);
            }
        }
        
        console.log(`\n📋 Adding features (${data.features.length} total)...`);
        
        // Filter out empty/invalid features
        const validFeatures = data.features.filter(feature => 
            feature.name && 
            feature.name.trim() && 
            !feature.name.includes('Attached File Name') &&
            !feature.name.includes('Answer Guidance') &&
            !feature.name.includes('Privacy Notice')
        );
        
        console.log(`  📝 Processing ${validFeatures.length} valid features...\n`);
        
        let successCount = 0;
        let errorCount = 0;
        
        // Group features by category for organized output
        const featuresByCategory = validFeatures.reduce((acc, feature) => {
            if (!acc[feature.category]) {
                acc[feature.category] = [];
            }
            acc[feature.category].push(feature);
            return acc;
        }, {});
        
        // Add features category by category
        for (const [categoryName, features] of Object.entries(featuresByCategory)) {
            console.log(`\n  📂 ${categoryName} (${features.length} features):`);
            
            const categoryId = categoryIdMap.get(categoryName);
            if (!categoryId) {
                console.log(`    ❌ Category ID not found for: ${categoryName}`);
                continue;
            }
            
            for (const feature of features) {
                try {
                    const response = await fetch(`${API_BASE}/api/features`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            name: feature.name.trim(),
                            description: feature.description || '',
                            categoryId: categoryId
                        })
                    });
                    
                    if (response.ok) {
                        successCount++;
                        console.log(`    ✅ ${feature.name}`);
                    } else {
                        errorCount++;
                        const error = await response.text();
                        console.log(`    ❌ Failed: ${feature.name} - ${error}`);
                    }
                    
                    // Small delay to avoid overwhelming the API
                    await new Promise(resolve => setTimeout(resolve, 50));
                    
                } catch (error) {
                    errorCount++;
                    console.log(`    ❌ Error adding ${feature.name}: ${error.message}`);
                }
            }
        }
        
        console.log('\n' + '='.repeat(60));
        console.log('🎉 Data import completed!');
        console.log(`📊 Summary:`);
        console.log(`  Categories: ${data.categories.length} created`);
        console.log(`  Features: ${successCount} added successfully`);
        if (errorCount > 0) {
            console.log(`  Errors: ${errorCount} failed`);
        }
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Error during import:', error);
    }
}

// Run the import
addCategoriesAndFeatures();