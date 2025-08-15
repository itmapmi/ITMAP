import fs from 'fs';

// Read the API data
const apiData = JSON.parse(fs.readFileSync('api-upload-data.json', 'utf8'));

// Split support data into smaller chunks (100 records each)
const chunkSize = 100;
const chunks = [];
for (let i = 0; i < apiData.supportData.length; i += chunkSize) {
  chunks.push(apiData.supportData.slice(i, i + chunkSize));
}

console.log(`Split ${apiData.supportData.length} support records into ${chunks.length} chunks`);

// Create upload commands for chunked data
const uploadCommands = [
  'echo "Uploading support matrix data in chunks..."',
  'echo "Logging in..."',
  'curl -c cookies.txt -X POST http://localhost:5000/api/auth/login \\',
  '  -H "Content-Type: application/json" \\',
  '  -d \'{"email":"admin@itmap.com","password":"admin123"}\'',
  '',
  'echo "\\nUploading categories and features (initial setup)..."',
  `curl -b cookies.txt -X POST http://localhost:5000/api/admin/bulk-upload-support-matrix \\`,
  '  -H "Content-Type: application/json" \\',
  `  -d '${JSON.stringify({ 
    categories: apiData.categories, 
    features: apiData.features, 
    supportData: chunks[0] // First chunk
  })}'`,
  ''
];

// Add commands for remaining chunks
for (let i = 1; i < chunks.length; i++) {
  uploadCommands.push(`echo "\\nUploading support data chunk ${i + 1}/${chunks.length}..."`);
  uploadCommands.push(`curl -b cookies.txt -X POST http://localhost:5000/api/admin/bulk-upload-support-matrix \\`);
  uploadCommands.push(`  -H "Content-Type: application/json" \\`);
  uploadCommands.push(`  -d '${JSON.stringify({ 
    categories: [], 
    features: [], 
    supportData: chunks[i] 
  })}'`);
  uploadCommands.push('');
}

uploadCommands.push('echo "\\nUpload complete!"');

fs.writeFileSync('upload-chunks.sh', uploadCommands.join('\n'));
console.log('Chunked upload commands saved to upload-chunks.sh');

// Also create individual chunk files for manual verification
chunks.forEach((chunk, index) => {
  const chunkData = {
    categories: index === 0 ? apiData.categories : [],
    features: index === 0 ? apiData.features : [],
    supportData: chunk
  };
  fs.writeFileSync(`chunk-${index + 1}.json`, JSON.stringify(chunkData, null, 2));
});

console.log(`Created ${chunks.length} individual chunk files`);