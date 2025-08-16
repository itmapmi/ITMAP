import fs from 'fs';

// Read the original upload data
const uploadData = JSON.parse(fs.readFileSync('upload-data.json', 'utf8'));

// Filter NetApp data
const netappSupportData = uploadData.supportData.filter(item => 
  item.vendorProduct && item.vendorProduct.toLowerCase().includes('netapp')
);

console.log(`Found ${netappSupportData.length} NetApp support records`);

// Prepare update data
const updateData = {
  categories: [],
  features: [],
  supportData: netappSupportData
};

// Save to file
fs.writeFileSync('netapp-update.json', JSON.stringify(updateData, null, 2));

// Also show first few records to verify
console.log('Sample NetApp records:');
console.log(JSON.stringify(netappSupportData.slice(0, 3), null, 2));

console.log('NetApp update file created: netapp-update.json');