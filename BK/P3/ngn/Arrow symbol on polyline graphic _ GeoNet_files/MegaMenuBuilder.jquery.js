/* MEGA-MENU GETTERS */
var _jsonMegaMenu = _jsonMegaMenu || null;
var _MegaMenu = _MegaMenu || null;
var MegaMenu = MegaMenu || null;
var MegaMenu = _jsonMegaMenu || _MegaMenu || MegaMenu || {};
var _jq;
function MegaMenuBuilder(specs) {
    /*-------------------------------------------------------------------->
        SETUP
    <--------------------------------------------------------------------*/
    var self = this;


    this.defaults = {
        mmData: _MegaMenu || '',
        container: '#buildMegaMenu'
    }

    this.specs = jQuery.extend(this.defaults, (specs || {}));

	//this.mmLogin = new MegaMenuLogin();

    /*-------------------------------------------------------------------->
        RENDERING
    <--------------------------------------------------------------------*/
    this.renderMegaMenu = function () {
        var html = '<div id="mmHeader"><div class="container">';

        html += '<div id="header-logo"><a href="http://www.esri.com/" id="homelink" title="Esri"></a></div>';

        html += '<div id="header-nav">';

        // build main nav
        html += '<ul id="nav">';
        for (var i = 0, len = MegaMenu.sections.length; i < len; i++) {
            var section = MegaMenu.sections[i];

            if (section.gateways.length > 0) {
              html += '<li id="' + section.id + '-nav"><a data-name="' + section.id + '">' + section.display + '</a></li>';
            } else {
              html += '<li id="' + section.id + '-nav" class="' + section.cssClass + '"><a href="http://www.esri.com' + section.link + '">' + section.display + '</a></li>';
            }
        }

        /*MegaMenu.sections.map(function(section){
		  html += '<li id="'+ section.id +'-nav"><a data-name="'+ section.id +'">'+ section.display +'</a></li>';
		});*/
        html += '</ul>';
        // end main nav
        html += '</div>';


	//my esri login
	//html+= self.mmLogin.render(false);





        // search need to fix
			html +=
			//'<div id="header-search" onkeypress="javascript:return WebForm_FireDefaultButton(event, \'submit\')">'
			'<div id="header-search" >'
				+'<div class="form" id="searchbox">'
					+'<form id="megamenu-search-form" onsubmit="return _runEsriSearch(jQuery(\'#megamenu-search-input\').val());">'/*
					html += '<input type="hidden" name="h" value="10" class="init_css">';
					html += '<input type="hidden" name="ho" value="0" class="init_css">';*/

					+'<input name="megamenu-search-input" type="text" maxlength="255" id="megamenu-search-input" class="">'
					//+'<input name="abovemain_0$mast" type="text" maxlength="255" id="mast" class="qtext">'
					+'<button value="&nbsp;" type="submit" name="megamenu_submit" id="submit" class="">&nbsp;</button>'
					//+'<button value="&nbsp;" type="submit" name="megamenu_submit" id="megamenu-search-input" class="">&nbsp;</button>'

					+'</form>'
				+'</div>'
			+'</div>';
		//end of search

        html += '</div></div>';
        // end of header and container


        html += '<div id="mega-menu" class="clearfix"><div class="container">';

        MegaMenu.sections.map(function (section) {
            html += '<ul id="' + section.id + '" class="menu-slide clearfix">';

            if (section.gateways.length > 0) {
              html += '<span class="menu-nav">' + section.display + '</span>';
            } else {
              html += '<a href="http://www.esri.comI' + section.link + '"><span class="menu-nav">' + section.display + '</span></a>';
            }


            var gatewayURL;
            var pageURL;
      			var glinkurl;

            section.gateways.map(function (gwID) {
                var gateway = getGateway(gwID);
                var cssStr = (gateway.grid || gateway.cssClass ||'');

//              gatewayURL = '//www.esri.com' +(gateway.link||'');

                glinkurl = (gatewayURL && gatewayURL.link) || '';

                var jiveHeaderLinks = ['https://geonet.esri.com', 'https://geonet.esri.com/spaces', 'https://geonet.esri.com/places'];

                if(jiveHeaderLinks.indexOf(gateway.link) != -1){
                  gatewayURL = (gateway.link || '');
                } else {
                  gatewayURL = 'http://www.esri.com' + (gateway.link || '');
                }

                //(glinkurl.match(/^http|^\/\//) ? '' : '//www.esri.com') + (glinkurl || '');

                // Does this page have "All" in the ID
                if (gateway.id.indexOf('all') >= 0) {
                    html += '<ul class="' + cssStr + '">';
                    html += '<a href="'+gatewayURL+'" class="header-link all-topics"><h2>' + gateway.display + '</h2></a>';
                }
                    // Else continue building out the links like normal
                else {
                    html += '<ul class="' + cssStr + '">';
                    html += '<a href="'+gatewayURL+'" class="header-link"><h2>' + gateway.display + '</h2></a>';
                    html += '<span class="menu-sub-nav">' + gateway.display + '</span>';
					html += '<ul>';
                }

                gateway.pages.map(function (pgID) {
                    var page = getPage(pgID);
//                    pageURL = '//www.esri.com' +(page.link||'');
                    pageURL = (page.link.match(/^http|^\/\//) ? '' : 'http://www.esri.com') +(page.link||'');
                    // is this an overview link
                    if (page.display == 'Overview') {
                        html += '<li><a href="'+pageURL+'" class="overview-link">' + page.display + '</a></li>';
                    }
                        // else use regular link
                    else {
                        html += '<li><a href="'+pageURL+'" class="'+(page.css||'')+'">' + page.display + '</a></li>';
                    }

                });
                // end page map
					html += '</ul>';
                html += '</ul>';
            });

            // end gateway
            html += '</ul>';
        });
        // end section
        html += '</div></div>';

        jQuery('#buildMegaMenu').html(html);
    }//end RENDER
    /*-------------------------------------------------------------------->
        Helpers
    <--------------------------------------------------------------------*/



    return this;
}

/* BUILD SHOULD PRODUCE THIS RESULT
<!-- Mega Menu Section -->
<ul id="{{  Section ID  }}" class="menu-slide clearfix">
  <span class="menu-nav">{{  Section Title  }}</span>

  <ul class="{{ grid-# }}">
      <a href="{{  Gateway Link  }}" class="header-link"><h2>{{  Gateway Title  }}</h2></a>
      <span class="menu-sub-nav">{{  Gateway Title  }}</span>
      <ul>
        <li><a href="{{  Gateway Link  }}" class="overview-link">Overview</a></li>

        <!-- loop for pages -->
        <li><a href="{{  Child Link  }}">{{  Child Title  }}</a></li>
        <!-- end loop for pages -->

      </ul>
    </ul>
</ul>
<!-- End of Mega Menu Section -->
*/

function _runEsriSearch(query){
	window.location= 'http://search.esri.com/results/index.cfm?do=esri&q='+query+'&start=0';
	return false;
}


/* MEGA-MENU GETTERS */
function getSection(id) {
    return MegaMenu.sections.filter(function (s) { return s.id == id; })[0] || false;
}
function getGateway(id) {
    return MegaMenu.gateways.filter(function (g) { return g.id == id; })[0] || false;
}
function getPage(id) {
    return MegaMenu.pages.filter(function (p) { return p.id == id; })[0] || false;
}

var _MM;
jQuery(document).ready(function () {
    _MM = new MegaMenuBuilder();
    _MM.renderMegaMenu();
});
