const fs = require('fs');

function fixFile(path) {
    // Read as latin1 to get the actual byte values
    const latin1Content = fs.readFileSync(path, 'latin1');

    // Convert from latin1 to UTF-8
    const utf8Buffer = Buffer.from(latin1Content, 'latin1');

    fs.writeFileSync(path, utf8Buffer, 'utf8');
    console.log('Fixed:', path);
}

fixFile('D:/Projects/PAMS8/MS/Managers/ContextMenuManager.ts');
fixFile('D:/Projects/PAMS8/MS/Engines/SymbolEngine.ts');