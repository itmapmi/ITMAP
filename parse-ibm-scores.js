import XLSX from 'xlsx';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read the Excel file
const filePath = path.join(__dirname, 'attached_assets', 'high_end_storage_support_matrix_fs9500_1755435481069.xlsx');
const workbook = XLSX.readFile(filePath);

// Get the first worksheet
const sheetName = workbook.SheetNames[0];
const worksheet = workbook.Sheets[sheetName];

// Convert to JSON
const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

console.log('Worksheet name:', sheetName);
console.log('First 10 rows:');
data.slice(0, 10).forEach((row, index) => {
  console.log(`Row ${index}:`, row);
});

// Look for IBM-specific data
console.log('\nLooking for IBM data...');
data.forEach((row, index) => {
  if (row && row.some(cell => cell && cell.toString().toLowerCase().includes('ibm'))) {
    console.log(`IBM found at row ${index}:`, row);
  }
});

// Show total rows and columns
console.log(`\nTotal rows: ${data.length}`);
console.log(`Max columns: ${Math.max(...data.map(row => row ? row.length : 0))}`);