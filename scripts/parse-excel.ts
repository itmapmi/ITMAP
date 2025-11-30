import * as xlsx from 'xlsx';
import * as fs from 'fs';
import * as path from 'path';

const filePath = path.join(process.cwd(), 'attached_assets/ITMAP_for_Public_Cloud_Object_Storage_providers_export1_1764490472014.xlsx');

console.log('Reading Excel file:', filePath);

const fileBuffer = fs.readFileSync(filePath);
const workbook = xlsx.read(fileBuffer, { type: 'buffer' });

console.log('\n=== Sheet Names ===');
console.log(workbook.SheetNames);

for (const sheetName of workbook.SheetNames) {
  console.log(`\n=== ${sheetName} ===`);
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  
  // Print first 5 rows to understand structure
  console.log('First rows:');
  for (let i = 0; i < Math.min(data.length, 50); i++) {
    console.log(`Row ${i}:`, JSON.stringify(data[i]));
  }
  
  console.log(`\nTotal rows: ${data.length}`);
}
