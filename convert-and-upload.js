import fs from 'fs';

// Read the processed support matrix data
const data = JSON.parse(fs.readFileSync('processed-support-matrix.json', 'utf8'));

// Harvey Ball symbol to numeric mapping
const symbolToLevel = {
  '○': 0, // No support
  '◔': 1, // Limited support 
  '◑': 2, // Partial support
  '◕': 3, // Good support
  '●': 4  // Full support
};

// Extract unique categories
const categories = [];
const categorySet = new Set();

// Extract features and create category mapping
const features = [];
const supportData = [];

data.features.forEach((feature, index) => {
  // Add category if not already added
  if (!categorySet.has(feature.category)) {
    categories.push({
      name: feature.category,
      displayOrder: categories.length + 1
    });
    categorySet.add(feature.category);
  }

  // Add feature
  features.push({
    name: feature.name,
    description: `${feature.category} - ${feature.name}`,
    category: feature.category,
    displayOrder: index + 1
  });

  // Add support data for each vendor
  Object.entries(feature.support).forEach(([vendorProduct, support]) => {
    const supportLevel = symbolToLevel[support.level] || 0;
    
    supportData.push({
      vendorProduct: vendorProduct,
      featureName: feature.name,
      supportLevel: supportLevel,
      notes: support.notes || null
    });
  });
});

// Create the final upload format
const uploadData = {
  categories: categories,
  features: features,
  supportData: supportData
};

console.log(`Converted data summary:`);
console.log(`- Categories: ${categories.length}`);
console.log(`- Features: ${features.length}`);
console.log(`- Support records: ${supportData.length}`);

// Write the converted data
fs.writeFileSync('upload-data.json', JSON.stringify(uploadData, null, 2));
console.log('Converted data written to upload-data.json');

// Log some sample data for verification
console.log('\nSample categories:', categories.slice(0, 3));
console.log('\nSample features:', features.slice(0, 2));
console.log('\nSample support data:', supportData.slice(0, 3));