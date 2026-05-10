const fs = require('fs');

function fixFile(path) {
    // Read as binary
    const bytes = fs.readFileSync(path);

    // The corruption: UTF-8 encoded emojis are stored as individual bytes interpreted as Latin-1
    // Each emoji character becomes 2-4 single bytes when stored
    // To fix: read the Latin-1 interpretation back to UTF-8

    // Create a map of Latin-1 byte sequences to UTF-8 emojis
    const emojiMap = {
        // Center On - target
        'f09f8eaf': '🎯',
        // Remove - trash
        'f09f9791efb88': '🗑️',
        // Wrench - edit
        'e29e9f efb88': '🔧',
        // Lasso - select
        'f09f94b2': '🔲',
        // Magnifying glass - search
        'f09f948d': '🔍',
        // Green circle - own
        'f09f9f9c': '🟢',
        // Red circle - enemy
        'f09f94b4': '🔴',
        // Clipboard
        'f09f93ab': '📫',
        // Pin - paste
        'f09f938c': '📌',
        // Envelope - paste with offset
        'f09f9390': '📐',
        // Floppy disk - save
        'f09f94be': '💾',
        // Open folder
        'f09f9782': '📂',
        // Folder
        'f09f9382': '📂',
        // File cabinet
        'f09f9781': '📁',
        // House - home
        'f09f8e80': '🏠',
        // Globe - export
        'f09f8c90': '🌐',
        // Earth - import
        'f09f8c8d': '🌍',
        // Desk - save plan
        'f09f97bf efb88': '🛏️',
        // Map
        'f09f8f9e': '🗾',
        // Pushpin
        'f09f938c': '📌',
        // Stop
        'e2 9f 91': '⏹',
        // Check
        'e2 9c 85': '✕',
        // Circle
        'e2 9c 99': '⬇',
        // Triangle
        'e2 96 b2': '▲',
        // Square
        'e2 96 a1': '■',
        // Info
        'e2 84 a9 efb88': 'ℹ️',
        // Eye
        'f0 9f 91 81 efb88': '👁️',
    };

    // Actually, let's just identify the span elements with icon and fix based on context
    const content = bytes.toString('latin1');
    let fixed = content;

    // Find patterns: <span style="font-size:14px"> followed by multi-byte chars
    // The pattern shows: efbfbd followed by more bytes for corrupted ones
    // vs proper emoji sequences

    // Replace based on line context
    const lines = fixed.split('\n');
    for (let i = 0; i < lines.length; i++) {
        if (lines[i].includes('icon:') && lines[i].match(/<span style="font-size:14px">/)) {
            const labelIdx = lines[i].indexOf('label:');
            const iconIdx = lines[i].indexOf('icon:');

            // Determine the correct emoji based on context
            let correctEmoji = null;

            // Check for various labels in surrounding lines
            const context = lines.slice(Math.max(0, i-2), Math.min(lines.length, i+5)).join(' ');

            if (context.includes('Info')) correctEmoji = 'ℹ️';
            else if (context.includes('Center On')) correctEmoji = '🎯';
            else if (context.includes('Remove')) correctEmoji = '🗑️';
            else if (context.includes('Edit')) correctEmoji = '🔧';
            else if (context.includes('Move, Scale')) correctEmoji = '🔧';
            else if (context.includes('Disable Move')) correctEmoji = '✕';
            else if (context.includes('Control Points')) correctEmoji = '✕';
            else if (context.includes('Deactivate Control')) correctEmoji = '✕';
            else if (context.includes('Lasso')) correctEmoji = '🔲';
            else if (context.includes('Deselect') || context.includes('Add to Selection')) correctEmoji = '☒';
            else if (context.includes('Clear Selection')) correctEmoji = '✕';
            else if (context.includes('Move Selected')) correctEmoji = '⬇';
            else if (context.includes('Delete Selected')) correctEmoji = '🗑️';
            else if (context.includes('Select Similar') || context.includes('Same SIDC')) correctEmoji = '🔍';
            else if (context.includes('Same Echelon')) correctEmoji = '▣';
            else if (context.includes('Own Only')) correctEmoji = '🟢';
            else if (context.includes('Enemy')) correctEmoji = '🔴';
            else if (context.includes('Within')) correctEmoji = '◯';
            else if (context.includes('Within + Self')) correctEmoji = '●';
            else if (context.includes('Filter by Type') || context.includes('Points')) correctEmoji = '●';
            else if (context.includes('Areas')) correctEmoji = '▲';
            else if (context.includes('Lines')) correctEmoji = '═';
            else if (context.includes('Align') && context.includes('parent')) correctEmoji = '⊜';
            else if (context.includes('Align Left')) correctEmoji = '←';
            else if (context.includes('Align Right')) correctEmoji = '➨';
            else if (context.includes('Align Top')) correctEmoji = '↑';
            else if (context.includes('Align Bottom')) correctEmoji = '↓';
            else if (context.includes('Center on X')) correctEmoji = '↔';
            else if (context.includes('Center on Y')) correctEmoji = '↕';
            else if (context.includes('Distribute Horizontal')) correctEmoji = '⇔';
            else if (context.includes('Distribute Vertical')) correctEmoji = '⇕';
            else if (context.includes('Arrange') && context.includes('Line')) correctEmoji = '─';
            else if (context.includes('Column')) correctEmoji = '│';
            else if (context.includes('Square')) correctEmoji = '⊞';
            else if (context.includes('Triangle') && !context.includes('Inverted')) correctEmoji = '▲';
            else if (context.includes('Inverted Triangle')) correctEmoji = '▼';
            else if (context.includes('Wedge')) correctEmoji = '◥';
            else if (context.includes('Echelon Left')) correctEmoji = '↗';
            else if (context.includes('Echelon Right')) correctEmoji = '↘';
            else if (context.includes('Diamond')) correctEmoji = '◇';
            else if (context.includes('Circle')) correctEmoji = '○';
            else if (context.includes('Clipboard')) correctEmoji = '📋';
            else if (context.includes('Copy Symbol')) correctEmoji = '📋';
            else if (context.includes('Paste Symbol')) correctEmoji = '📌';
            else if (context.includes('Paste with Offset')) correctEmoji = '📐';
            else if (context.includes('Undo')) correctEmoji = '↩';
            else if (context.includes('Redo')) correctEmoji = '↪';
            else if (context.includes('Save / Load')) correctEmoji = '💾';
            else if (context.includes('Save Symbol')) correctEmoji = '💾';
            else if (context.includes('Save All')) correctEmoji = '🗂️';
            else if (context.includes('Load Symbol') || context.includes('Load Symbols')) correctEmoji = '📂';
            else if (context.includes('Save Plan')) correctEmoji = '💾';
            else if (context.includes('Load Plan')) correctEmoji = '📂';
            else if (context.includes('Export as GeoJSON')) correctEmoji = '🌐';
            else if (context.includes('Import GeoJSON')) correctEmoji = '🌍';
            else if (context.includes('Templates') || context.includes('Save as Template')) correctEmoji = '📌';
            else if (context.includes('Load Template')) correctEmoji = '📋';

            if (correctEmoji) {
                // Replace the span content
                lines[i] = lines[i].replace(/<span style="font-size:14px">[^<]*<\/span>/, `<span style="font-size:14px">${correctEmoji}</span>`);
            }
        }
    }

    fixed = lines.join('\n');

    // Convert from Latin-1 to UTF-8
    const utf8Buffer = Buffer.from(fixed, 'latin1');

    fs.writeFileSync(path, utf8Buffer);
    console.log('Fixed:', path);
}

fixFile('D:/Projects/PAMS8/MS/Managers/ContextMenuManager.ts');
fixFile('D:/Projects/PAMS8/MS/Engines/SymbolEngine.ts');