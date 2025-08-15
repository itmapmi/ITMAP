import XLSX from 'xlsx';
import fs from 'fs';

// Read the Excel file
const workbook = XLSX.readFile('attached_assets/high_end_storage_support_matrix_updated_1755283026056.xlsx');

// Get the first worksheet
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON
const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

console.log('Excel data:');
console.log(JSON.stringify(jsonData, null, 2));

// Save as JSON file for easier processing
fs.writeFileSync('support-matrix-data.json', JSON.stringify(jsonData, null, 2));
console.log('\nData saved to support-matrix-data.json');