$(document).ready(function () {
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

    function renderControlMeasureSvg(symbolCode) {
        var src = '../MS/Data/Preview/ControlMeasures/' + symbolCode + '.svg';
        var $img = $('<img>').attr('src', src).addClass('img-fluid').css({ maxHeight: '200px' });
        $img.on('error', function () {
            $(this).replaceWith($('<span>').addClass('text-muted').text('N/A'));
        });
        return $img;
    }

    $.getJSON('../MS/Data/Symbols.json')
        .done(function (symbolDefinitions) {
            var $tbody = $('#symbols-tbody');
            var rowNumber = 1;
            Object.entries(symbolDefinitions).forEach(function ([symbolCode, symbolDef]) {
                if (symbolDef && symbolCode.startsWith("25")) {
                    
                    var $tr = $('<tr>');
                    $('<td>').text(rowNumber++ +'.').appendTo($tr);
                    $('<td>').text(symbolDef.Name || '').appendTo($tr);
                    // Default SIDC shown: use Friend (index 3)
                    var defaultSIDC = buildSIDC(symbolCode, 3);
                    $('<td>').text(defaultSIDC).appendTo($tr);
                    // Function Code column = symbolId portion of the 8-char code
                    var functionCode = symbolCode.slice(2);
                    $('<td>').text(functionCode).appendTo($tr);
                    // Depiction column: load matching SVG from ControlMeasures
                    var $depictionTd = $('<td>').addClass('text-center');
                    $depictionTd.append(renderControlMeasureSvg(symbolCode));
                    $tr.append($depictionTd);
                    $tbody.append($tr);
                }
            });
        })
        .fail(function (jqXHR, textStatus, errorThrown) {
            console.error('Failed to load Symbols.json:', textStatus, errorThrown);
            $('#marker-container').text('Failed to load Symbols.json');
        });

});