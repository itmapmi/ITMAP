import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read the Excel file
const filePath = path.join(__dirname, '..', 'attached_assets', 'March24_with_questions_1757437794749.xlsx');

try {
    console.log('Reading Excel file...');
    const workbook = XLSX.readFile(filePath);
    console.log('Available sheets:', workbook.SheetNames);
    
    const extractedData = {
        categories: [],
        features: []
    };
    
    // Process each sheet (tab) as a feature category
    workbook.SheetNames.forEach((sheetName, index) => {
        console.log(`\nProcessing sheet: ${sheetName}`);
        
        const worksheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        // Create category
        const category = {
            name: sheetName,
            description: `Feature category for ${sheetName}`,
            displayOrder: index + 1
        };
        
        extractedData.categories.push(category);
        
        // Process rows to extract features and evaluation criteria
        console.log(`Found ${data.length} rows in ${sheetName}`);
        
        // Look for headers to understand the structure
        if (data.length > 0) {
            console.log('Headers:', data[0]);
            
            // Process each row after headers
            for (let i = 1; i < data.length; i++) {
                const row = data[i];
                if (row && row.length > 0 && row[0]) { // Skip empty rows
                    const feature = {
                        name: row[0]?.toString().trim(),
                        description: row[1]?.toString().trim() || '',
                        category: sheetName,
                        evaluationCriteria: row[2]?.toString().trim() || ''
                    };
                    
                    if (feature.name) {
                        extractedData.features.push(feature);
                        console.log(`  Feature: ${feature.name}`);
                        if (feature.evaluationCriteria) {
                            console.log(`    Criteria: ${feature.evaluationCriteria.substring(0, 100)}...`);
                        }
                    }
                }
            }
        }
    });
    
    // Save extracted data to JSON file for review
    const outputPath = path.join(__dirname, 'extracted-backup-data.json');
    fs.writeFileSync(outputPath, JSON.stringify(extractedData, null, 2));
    
    console.log(`\n✅ Data extraction complete!`);
    console.log(`📊 Categories found: ${extractedData.categories.length}`);
    console.log(`📋 Features found: ${extractedData.features.length}`);
    console.log(`📄 Data saved to: ${outputPath}`);
    
    // Display summary
    extractedData.categories.forEach(cat => {
        const featuresInCategory = extractedData.features.filter(f => f.category === cat.name);
        console.log(`  ${cat.name}: ${featuresInCategory.length} features`);
    });
    
} catch (error) {
    console.error('Error processing Excel file:', error);
    
    // Try to provide more details about the file
    try {
        const stats = fs.statSync(filePath);
        console.log('File exists, size:', stats.size, 'bytes');
    } catch (e) {
        console.log('File does not exist at:', filePath);
    }
}