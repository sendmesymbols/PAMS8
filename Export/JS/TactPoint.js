$(document).ready(function () {
    // Mapping of Standard Identity codes to descriptions
    const standardIdentities = {
        0: 'Pending',
        1: 'Unknown',
        2: 'Assumed Friend',
        3: 'Friend',
        4: 'Neutral',
        5: 'Suspect/Joker',
        6: 'Hostile/Faker'
    };

    function buildSIDC(baseCode, identityIndex) {
        const symbolSet = baseCode.slice(0, 2);      // positions 5–6
        const symbolId = baseCode.slice(2);          // becomes positions 11–20 (padded)
        const codingScheme = '10';                   // positions 1–2 (Warfighting)
        const standardIdentity = '0' + identityIndex; // positions 3–4
        const status = '0';                          // position 7 (Present)
        const hqModifier = '0';                      // position 8 (None)
        const amplifier1 = '00';                     // positions 9–10 (Default)
        const paddedEntityCode = symbolId.padEnd(10, '0');
        return codingScheme
            + standardIdentity
            + symbolSet
            + status
            + hqModifier
            + amplifier1
            + paddedEntityCode;                      // positions 11–20
    }

    function renderSymbolImage(sidc) {
        try {
            var dataUrl = new MS.symbol(sidc).getMarker().asImage();
            return $('<img>').attr('src', dataUrl).addClass('img-fluid').css({ maxHeight: '100px' });
        } catch (e) {
            return $('<span>').addClass('text-muted').text('N/A');
        }
    }

    $.getJSON('../MS/Data/Symbols.json')
        .done(function (symbolDefinitions) {
            var $tbody = $('#symbols-tbody');
            var rowNumber = 1;
            Object.entries(symbolDefinitions).forEach(function ([symbolCode, symbolDef]) {
                if (symbolDef && symbolDef.Class === 'TacticalPoint') {
                    var $tr = $('<tr>');
                    $('<td>').text(rowNumber++ +'.').appendTo($tr);
                    $('<td>').text(symbolDef.Name || '').appendTo($tr);
                    // Default SIDC shown: use Friend (index 3)
                    var defaultSIDC = buildSIDC(symbolCode, 3);
                    $('<td>').text(defaultSIDC).appendTo($tr);
                    // Function Code column = symbolId portion of the 8-char code
                    var functionCode = symbolCode.slice(2);
                    $('<td>').text(functionCode).appendTo($tr);
                    for (let i = 0; i <= 6; i++) {
                        var fullSIDC = buildSIDC(symbolCode, i);
                        var $td = $('<td>').addClass('text-center');
                        var $img = renderSymbolImage(fullSIDC);
                        $td.append($img);
                        $tr.append($td);
                    }
                    $tbody.append($tr);
                }
            });
        })
        .fail(function (jqXHR, textStatus, errorThrown) {
            console.error('Failed to load Symbols.json:', textStatus, errorThrown);
            $('#marker-container').text('Failed to load Symbols.json');
        });

});