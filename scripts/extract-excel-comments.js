import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const filePath = path.join(__dirname, '..', 'attached_assets', 'March24_with_questions (1)_1757443684303.xlsx');

console.log('🔍 Extracting detailed Excel cell comments and notes...\n');

try {
    const workbook = XLSX.readFile(filePath, { cellStyles: true, cellNF: true, cellHTML: false });
    
    console.log('Available sheets:', workbook.SheetNames);
    
    const sheetName = 'Ransomware Detection and Recove';
    const worksheet = workbook.Sheets[sheetName];
    
    if (!worksheet) {
        console.log('❌ Sheet not found');
        process.exit(1);
    }
    
    console.log(`\n📋 Analyzing sheet: ${sheetName}\n`);
    
    // Get the range of the worksheet
    const range = XLSX.utils.decode_range(worksheet['!ref']);
    console.log(`Sheet range: ${worksheet['!ref']}`);
    
    // Extract all cell data with detailed analysis
    const cellData = [];
    const cellComments = [];
    
    for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ c: C, r: R });
            const cell = worksheet[cellAddress];
            
            if (cell) {
                // Check for cell value
                let cellInfo = {
                    address: cellAddress,
                    row: R,
                    col: C,
                    value: cell.v || '',
                    formula: cell.f || null,
                    type: cell.t || 'unknown'
                };
                
                // Check for Excel comments/notes
                if (cell.c && cell.c.length > 0) {
                    cellInfo.comments = cell.c.map(comment => ({
                        text: comment.t,
                        author: comment.a || 'Unknown',
                        hidden: comment.h || false
                    }));
                    cellComments.push(cellInfo);
                }
                
                // Show non-empty cells for context
                if (cell.v !== undefined && cell.v !== '') {
                    cellData.push(cellInfo);
                }
            }
        }
    }
    
    console.log(`📊 Found ${cellData.length} non-empty cells`);
    console.log(`💬 Found ${cellComments.length} cells with comments\n`);
    
    if (cellComments.length > 0) {
        console.log('📝 Excel Comments Found:');
        console.log('='.repeat(80));
        
        cellComments.forEach(cell => {
            console.log(`\n📍 Cell ${cell.address} (Row ${cell.row + 1}, Col ${cell.col + 1}):`);
            console.log(`   Value: "${cell.value}"`);
            console.log(`   Comments:`);
            cell.comments.forEach(comment => {
                console.log(`     Author: ${comment.author}`);
                console.log(`     Text: "${comment.text}"`);
            });
        });
    } else {
        console.log('⚠️  No Excel cell comments found.\n');
        
        // Show sample of cell values to understand data format
        console.log('📋 Sample cell values (first 20):');
        console.log('-'.repeat(50));
        
        cellData.slice(0, 20).forEach(cell => {
            if (cell.row > 0 && cell.col > 1) { // Skip headers and first column
                console.log(`${cell.address}: "${cell.value}"`);
            }
        });
        
        // Check if values contain detailed text vs just ratings
        const vendorCells = cellData.filter(cell => cell.row > 0 && cell.col > 1);
        const hasDetailedText = vendorCells.some(cell => 
            typeof cell.value === 'string' && cell.value.length > 10
        );
        
        console.log(`\n📊 Analysis:`);
        console.log(`  Total vendor rating cells: ${vendorCells.length}`);
        console.log(`  Cells with detailed text (>10 chars): ${vendorCells.filter(cell => typeof cell.value === 'string' && cell.value.length > 10).length}`);
        console.log(`  Average cell text length: ${vendorCells.reduce((sum, cell) => sum + String(cell.value).length, 0) / vendorCells.length}`);
        
        if (!hasDetailedText) {
            console.log('\n⚠️  Excel file appears to contain only basic rating text, not detailed commentary.');
            console.log('   Consider checking if the detailed comments are in a different sheet or format.');
        }
    }
    
    // Save extraction for review
    const output = {
        cellData: cellData.slice(0, 50), // First 50 cells
        cellComments: cellComments,
        analysis: {
            totalCells: cellData.length,
            cellsWithComments: cellComments.length,
            sheetRange: worksheet['!ref']
        }
    };
    
    const outputPath = path.join(__dirname, 'excel-extraction.json');
    fs.writeFileSync(outputPath, JSON.stringify(output, null, 2));
    console.log(`\n📄 Detailed extraction saved to: ${outputPath}`);
    
} catch (error) {
    console.error('❌ Error extracting Excel comments:', error);
}