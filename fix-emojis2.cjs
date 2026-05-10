const fs = require('fs');

function fixEncoding(path) {
    // Read the file as UTF-8 (corrupting the emojis)
    let corrupted = fs.readFileSync(path, 'utf8');

    // The emojis were double-encoded: UTF-8 bytes interpreted as Latin-1 and stored as UTF-8
    // To fix: interpret the corrupted string as Latin-1 (ISO-8859-1), then encode as UTF-8
    let fixed = '';
    for (let i = 0; i < corrupted.length; i++) {
        const charCode = corrupted.charCodeAt(i);
        fixed += String.fromCharCode(charCode);
    }
    // Now convert from Latin-1 to UTF-8
    const latinBuffer = Buffer.from(fixed, 'latin1');
    const utf8Fixed = latinBuffer.toString('utf8');

    fs.writeFileSync(path, utf8Fixed, 'utf8');
    console.log('Fixed:', path);
}

fixEncoding('D:/Projects/PAMS8/MS/Managers/ContextMenuManager.ts');
fixEncoding('D:/Projects/PAMS8/MS/Engines/SymbolEngine.ts');