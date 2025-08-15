import fs from 'fs';

// Read the parsed data
const data = JSON.parse(fs.readFileSync('support-matrix-data.json', 'utf8'));

// First row should contain the header with vendor names
const headerRow = data[0];
console.log('Header row:', headerRow);

// Process the data to extract vendors, features, and support levels
const vendors = [];
const features = [];
const supportData = [];

// Extract vendor information from header (starting from column 2, every 2 columns)
for (let i = 2; i < headerRow.length; i += 2) { // Every 2 columns (rating column + notes column)
  if (headerRow[i] && headerRow[i].includes('Rating')) {
    // Extract vendor name from "Vendor Product Rating" format
    const vendorProduct = headerRow[i].replace(' Rating', '');
    vendors.push(vendorProduct);
  }
}

console.log('\nVendors found:', vendors);

// Extract features and support levels from data rows
for (let rowIndex = 1; rowIndex < data.length; rowIndex++) {
  const row = data[rowIndex];
  if (row.length > 0 && row[0] && row[1]) { // Has category and feature name
    const category = row[0];
    const featureName = row[1];
    
    const feature = {
      category,
      name: featureName,
      support: {}
    };
    
    // Extract support levels for each vendor
    for (let vendorIndex = 0; vendorIndex < vendors.length; vendorIndex++) {
      const supportCol = 2 + (vendorIndex * 2); // Support level column
      const notesCol = 3 + (vendorIndex * 2);   // Notes column
      
      const supportLevel = row[supportCol] || '';
      const notes = row[notesCol] || '';
      
      feature.support[vendors[vendorIndex]] = {
        level: supportLevel,
        notes: notes
      };
    }
    
    features.push(feature);
  }
}

console.log('\nFirst few features:');
features.slice(0, 3).forEach(feature => {
  console.log(`${feature.category} - ${feature.name}`);
  Object.entries(feature.support).forEach(([vendor, support]) => {
    console.log(`  ${vendor}: ${support.level} - ${support.notes.substring(0, 50)}...`);
  });
});

// Save processed data
const processedData = {
  vendors,
  features,
  summary: {
    totalVendors: vendors.length,
    totalFeatures: features.length,
    categories: [...new Set(features.map(f => f.category))]
  }
};

fs.writeFileSync('processed-support-matrix.json', JSON.stringify(processedData, null, 2));
console.log('\nProcessed data saved to processed-support-matrix.json');
console.log(`Found ${vendors.length} vendors and ${features.length} features`);
console.log('Categories:', processedData.summary.categories);