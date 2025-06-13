var svg_frame;
var sym_data;
var tact_syms;
var total = 0;
var counter = 0;
var INCREMENT = 20;

function run() {
    load_svg_frame();
    load_sym_data();
    document.getElementById('export_all_btn').onclick = export_sym;

}


function process_data(data) {
    var svg_house = document.getElementById('svg_house');
    $.each(data, function (key, val) {
        var sym_set = key.substr(0, 2);
        var sid = key.substr(2, key.length);
        var status = "0";
        var baseEch = "00";
        var sidc = "1006" + sym_set + status + "0" + baseEch + sid + "0000";        
        if (val.Class === "TacticalPoint") {
            total += 1;
            var current_sidc = set(sidc, String(3));
            var svg = document.createElement('div');
            svg.setAttribute('class', 'svg_inner');
            var span = document.createElement('span');
            span.innerHTML = current_sidc + '<br>' + val.Name;
            var tact_sym_path_data = tact_syms[sym_set+sid];            
            var final_data = create_svg_from_path(svg_frame, tact_sym_path_data).outerHTML;
            svg.innerHTML = final_data;
            svg_house.appendChild(svg);
            svg.appendChild(span);            
        }
    });
    print("Total Symbols are " + total + " and counter is " + counter);
}


function saveSvg(svgEl, name, sidc) {
    svgEl.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    
    var index = sidc.substr(3, 1);
    /*
    svgEl.firstElementChild.remove();
    if (index === '0' || index === '2' || index === '5') {
        svgEl.firstElementChild.remove();
    }
    */

    switch (index) {
        case "0":
            name += ' - Pending '
            break;
        case "1":
            name += ' - Unknown '
            break;
        case "2":
            name += ' - Assumed Friend '
            break;
        case "3":
            name += ' - Friend '
            break;
        case "4":
            name += ' - Neutral '
            break;
        case "5":
            name += ' - Suspect or Joker '
            break;
        case "6":
            name += ' - Hostile or Faker '
            break;
        default:
            break;
    }
    var svgData = svgEl.outerHTML;
    var preface = '<?xml version="1.0" standalone="no"?>\r\n';
    var svgBlob = new Blob([svgData], {
        type: "image/svg+xml;charset=utf-8"
    });
    var svgUrl = URL.createObjectURL(svgBlob);
    var downloadLink = document.createElement("a");
    downloadLink.href = svgUrl;
    downloadLink.download = name + '.svg';
    document.body.appendChild(downloadLink);
    downloadLink.click();
    document.body.removeChild(downloadLink);
}

function export_sym(evt) {
    if (counter > total) {
        counter = total;
    }
    debugger;
    var svg_divs = document.getElementsByClassName('svg_inner');
    var inner_counter = 0;
    for (var i = counter; i <= total; i++, counter++, inner_counter++) {
        var svgData = svg_divs[i].firstChild;
        var sidcData = svg_divs[i].lastChild;
        if (inner_counter >= INCREMENT) break;
        saveSvg(svgData, sidcData.innerText.split('\n').join('-'), sidcData.innerText.split('\n')[0]);
    }


    console.log('counter is ' + counter)



}


function load_sym_data() {
    $.getJSON('./resources/Symbols.json')
        .done(function (data) {
            sym_data = data;
            $.getJSON('./resources/TacticalPointSymbols.json')
        .done(function (data) {
            tact_syms = data;
            process_data(sym_data);
        });
        });
}


function create_svg_from_path(svg_frame, svg_path) {    
        svg_frame.firstElementChild.setAttribute('d', svg_path);        
        return svg_frame;
}

function load_svg_frame() {
    jQuery.get('./resources/svg_frame.svg', function (content) {
        svg_frame = content.children[0];
    })
}


function create_html_from_text(text) {
    var div = document.createElement('div');
    div.innerHTML = text.trim();
    return div.firstChild;
}

function set(sidc, number) {
    sidc = sidc.toString();
    //console.log(Number(sidc.substr(0, 3) + number + sidc.substr(3 + 1)));
    return Number(sidc.substr(0, 3) + number + sidc.substr(3 + 1));
}