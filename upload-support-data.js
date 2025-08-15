import fs from 'fs';

// Harvey Ball to numeric conversion
const harveyBallToLevel = {
  '●': 4, // Full support
  '◕': 3, // Good support  
  '◑': 2, // Partial support
  '◔': 1, // Limited support
  '○': 0, // No support
  '': 0   // Empty = no support
};

// Read processed data
const processedData = JSON.parse(fs.readFileSync('processed-support-matrix.json', 'utf8'));

// Convert to API format
const apiData = {
  categories: processedData.summary.categories.map((name, index) => ({
    name,
    displayOrder: index + 1
  })),
  features: processedData.features.map((feature, index) => ({
    name: feature.name,
    description: `${feature.category} - ${feature.name}`,
    category: feature.category,
    displayOrder: index + 1
  })),
  supportData: []
};

// Convert support data for each vendor-feature combination
processedData.features.forEach(feature => {
  Object.entries(feature.support).forEach(([vendorProduct, supportInfo]) => {
    apiData.supportData.push({
      vendorProduct,
      featureName: feature.name,
      supportLevel: harveyBallToLevel[supportInfo.level] || 0,
      notes: supportInfo.notes || ''
    });
  });
});

console.log(`Prepared ${apiData.categories.length} categories`);
console.log(`Prepared ${apiData.features.length} features`);
console.log(`Prepared ${apiData.supportData.length} support records`);

// Save for API upload
fs.writeFileSync('api-upload-data.json', JSON.stringify(apiData, null, 2));
console.log('Data prepared for API upload in api-upload-data.json');

// Create curl command to upload data
const curlCommands = [
  'echo "Uploading support matrix data..."',
  'echo "Logging in..."',
  'curl -c cookies.txt -X POST http://localhost:5000/api/auth/login \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"email":"admin@itmap.com","password":"admin123"}\'',
  '',
  'echo "\\nUploading categories and features..."',
  'curl -b cookies.txt -X POST http://localhost:5000/api/admin/bulk-upload-support-matrix \\',
  '  -H "Content-Type: application/json" \\',
  '  -d @api-upload-data.json',
  '',
  'echo "\\nUpload complete!"'
];

fs.writeFileSync('upload-commands.sh', curlCommands.join('\n'));
console.log('Upload commands saved to upload-commands.sh');