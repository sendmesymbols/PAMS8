/*
 * Copyright (C) 1999-2015 Jive Software. All rights reserved.
 *
 * This software is the proprietary information of Jive Software. Use is subject to license terms.
 */

/**
 * This is the n4jive object declaration. holds the global defaults for things. 
 * only one of these per page will be instantiated.
 */

define([
    'jquery',
    'apps/shared/views/loader_view'
], function($, LoaderView){
    var n4jive = {};
    
    $.extend(n4jive, {
        data: {},  //just a place to handily dump stuff to.
        self: this,
        settings: {}
    });

	n4jive.old = {};
	
	n4jive.workingFactory = function(pTarget) {
	    var spinner = new LoaderView({size: 'small', showLabel: false});
        spinner.appendTo(pTarget);

        return function(){
            if (spinner) {
                spinner.hide().destroy();
                spinner = null;
            }
        };
    }
    
	n4jive.addCommas = function(nStr){
		nStr += '';
		x = nStr.split('.');
		x1 = x[0];
		x2 = x.length > 1 ? '.' + x[1] : '';
		var rgx = /(\d+)(\d{3})/;
		while (rgx.test(x1)) {
		x1 = x1.replace(rgx, '$1' + ',' + '$2');
		}
		return x1 + x2;				
	}	
	
	n4jive.getIntPercentage = function(num1, num2){
		return  Math.round((num1/num2) * 100);
	}

	n4jive.showLoadingSpinners = function(){
		for(i in arguments){
			var el = arguments[i];
			el.prepend("<img src='https://assets.bunchball.net/widgets/jive/test/images/ajaxload.gif' style='width:auto' class='n4jive_loading_spinner' />");
		}
	}

	n4jive.destroyLoadingSpinners = function(){
		$(".n4jive_loading_spinner").remove();
	}
	
	n4jive.getSanitizeChallengesResponse = function(responseObj){
		var challenges = new Array();
		//check for no one first...
		
		if(responseObj.res != "ok" || responseObj.challenges == true){
			//hide the 'recent challenges' header
			$("#n4jive_hover_recent_challenges").hide();
			
			//BAIL!				
			return []; 
		}
		
		//organize challenges...
		//single challenge
		if(typeof responseObj.challenges.Challenge.length == "undefined"){
			challenges.push(responseObj.challenges.Challenge);			
		}
		//multiple challenges
		else{
			for(i=0;i<responseObj.challenges.Challenge.length;i++){
				challenges.push(responseObj.challenges.Challenge[i]);
			}
		}
		
		return challenges;
	}
	
	n4jive.getJiveHoverTipHTML = function(content, showLoader){
		var h = '<div class="jive-tooltip2 notedefault snp-mouseoffset" id="n4jive_hover_tip" style="visibility: visible">'+
					'<div class="jive-tooltip2-mid j-mini-modal j-mini-modal-user">' +
						'<div id="jive-note-user-body" class="n4jive_hover_tip_body jive-tooltip2-mid-padding j-modal-content clearfix">';
						if(typeof showLoader != 'undefined' && showLoader){
							h += '<p>Loading...</p>';
						}
						h += content;
					h += '</div>' +
					'</div>' +
				'</div>'
		return h;
	}
	
	n4jive.md5 = function(C){var D;var w=function(b,a){return(b<<a)|(b>>>(32-a))};var H=function(k,b){var V,a,d,x,c;d=(k&2147483648);x=(b&2147483648);V=(k&1073741824);a=(b&1073741824);c=(k&1073741823)+(b&1073741823);if(V&a){return(c^2147483648^d^x)}if(V|a){if(c&1073741824){return(c^3221225472^d^x)}else{return(c^1073741824^d^x)}}else{return(c^d^x)}};var r=function(a,c,b){return(a&c)|((~a)&b)};var q=function(a,c,b){return(a&b)|(c&(~b))};var p=function(a,c,b){return(a^c^b)};var n=function(a,c,b){return(c^(a|(~b)))};var u=function(W,V,aa,Z,k,X,Y){W=H(W,H(H(r(V,aa,Z),k),Y));return H(w(W,X),V)};var f=function(W,V,aa,Z,k,X,Y){W=H(W,H(H(q(V,aa,Z),k),Y));return H(w(W,X),V)};var F=function(W,V,aa,Z,k,X,Y){W=H(W,H(H(p(V,aa,Z),k),Y));return H(w(W,X),V)};var t=function(W,V,aa,Z,k,X,Y){W=H(W,H(H(n(V,aa,Z),k),Y));return H(w(W,X),V)};var e=function(V){var W;var d=V.length;var c=d+8;var b=(c-(c%64))/64;var x=(b+1)*16;var X=new Array(x-1);var a=0;var k=0;while(k<d){W=(k-(k%4))/4;a=(k%4)*8;X[W]=(X[W]|(V.charCodeAt(k)<<a));k++}W=(k-(k%4))/4;a=(k%4)*8;X[W]=X[W]|(128<<a);X[x-2]=d<<3;X[x-1]=d>>>29;return X};var s=function(d){var a="",b="",k,c;for(c=0;c<=3;c++){k=(d>>>(c*8))&255;b="0"+k.toString(16);a=a+b.substr(b.length-2,2)}return a};var E=[],L,h,G,v,g,U,T,S,R,O=7,M=12,J=17,I=22,B=5,A=9,z=14,y=20,o=4,m=11,l=16,j=23,Q=6,P=10,N=15,K=21;C=this.utf8_encode(C);E=e(C);U=1732584193;T=4023233417;S=2562383102;R=271733878;D=E.length;for(L=0;L<D;L+=16){h=U;G=T;v=S;g=R;U=u(U,T,S,R,E[L+0],O,3614090360);R=u(R,U,T,S,E[L+1],M,3905402710);S=u(S,R,U,T,E[L+2],J,606105819);T=u(T,S,R,U,E[L+3],I,3250441966);U=u(U,T,S,R,E[L+4],O,4118548399);R=u(R,U,T,S,E[L+5],M,1200080426);S=u(S,R,U,T,E[L+6],J,2821735955);T=u(T,S,R,U,E[L+7],I,4249261313);U=u(U,T,S,R,E[L+8],O,1770035416);R=u(R,U,T,S,E[L+9],M,2336552879);S=u(S,R,U,T,E[L+10],J,4294925233);T=u(T,S,R,U,E[L+11],I,2304563134);U=u(U,T,S,R,E[L+12],O,1804603682);R=u(R,U,T,S,E[L+13],M,4254626195);S=u(S,R,U,T,E[L+14],J,2792965006);T=u(T,S,R,U,E[L+15],I,1236535329);U=f(U,T,S,R,E[L+1],B,4129170786);R=f(R,U,T,S,E[L+6],A,3225465664);S=f(S,R,U,T,E[L+11],z,643717713);T=f(T,S,R,U,E[L+0],y,3921069994);U=f(U,T,S,R,E[L+5],B,3593408605);R=f(R,U,T,S,E[L+10],A,38016083);S=f(S,R,U,T,E[L+15],z,3634488961);T=f(T,S,R,U,E[L+4],y,3889429448);U=f(U,T,S,R,E[L+9],B,568446438);R=f(R,U,T,S,E[L+14],A,3275163606);S=f(S,R,U,T,E[L+3],z,4107603335);T=f(T,S,R,U,E[L+8],y,1163531501);U=f(U,T,S,R,E[L+13],B,2850285829);R=f(R,U,T,S,E[L+2],A,4243563512);S=f(S,R,U,T,E[L+7],z,1735328473);T=f(T,S,R,U,E[L+12],y,2368359562);U=F(U,T,S,R,E[L+5],o,4294588738);R=F(R,U,T,S,E[L+8],m,2272392833);S=F(S,R,U,T,E[L+11],l,1839030562);T=F(T,S,R,U,E[L+14],j,4259657740);U=F(U,T,S,R,E[L+1],o,2763975236);R=F(R,U,T,S,E[L+4],m,1272893353);S=F(S,R,U,T,E[L+7],l,4139469664);T=F(T,S,R,U,E[L+10],j,3200236656);U=F(U,T,S,R,E[L+13],o,681279174);R=F(R,U,T,S,E[L+0],m,3936430074);S=F(S,R,U,T,E[L+3],l,3572445317);T=F(T,S,R,U,E[L+6],j,76029189);U=F(U,T,S,R,E[L+9],o,3654602809);R=F(R,U,T,S,E[L+12],m,3873151461);S=F(S,R,U,T,E[L+15],l,530742520);T=F(T,S,R,U,E[L+2],j,3299628645);U=t(U,T,S,R,E[L+0],Q,4096336452);R=t(R,U,T,S,E[L+7],P,1126891415);S=t(S,R,U,T,E[L+14],N,2878612391);T=t(T,S,R,U,E[L+5],K,4237533241);U=t(U,T,S,R,E[L+12],Q,1700485571);R=t(R,U,T,S,E[L+3],P,2399980690);S=t(S,R,U,T,E[L+10],N,4293915773);T=t(T,S,R,U,E[L+1],K,2240044497);U=t(U,T,S,R,E[L+8],Q,1873313359);R=t(R,U,T,S,E[L+15],P,4264355552);S=t(S,R,U,T,E[L+6],N,2734768916);T=t(T,S,R,U,E[L+13],K,1309151649);U=t(U,T,S,R,E[L+4],Q,4149444226);R=t(R,U,T,S,E[L+11],P,3174756917);S=t(S,R,U,T,E[L+2],N,718787259);T=t(T,S,R,U,E[L+9],K,3951481745);U=H(U,h);T=H(T,G);S=H(S,v);R=H(R,g)}var i=s(U)+s(T)+s(S)+s(R);return i.toLowerCase()};
	
	
    /**
     *  This method allows the script to check the compatibility of CSS3 styles that may or may not be mainstream.
     *  It simply selects the name of the style, then checks vendor prefixes automatically.
     *
     *  @param      {string} The style to check for support
     *  @returns    {boolean} Is the style supported?
     */
    n4jive.cssCompatibilityChecker = function(pStyle) {
        if ( this.css3Enabled ) { return true; }
        var
            CSSprefix = "Webkit,Moz,O,ms,Khtml".split(","),
            d = document.createElement("detect"),
            test = [],
            p, pty;

        // test prefixed codes
        function TestPrefixes(property) {
            var
                Uprop = property.charAt(0).toUpperCase() + property.substr(1),
                All = (property + ' ' + CSSprefix.join(Uprop + ' ') + Uprop).split(' ');
            for (var n = 0, np = All.length; n < np; n++) {
                if (d.style[All[n]] === "") return true;
            }
            return false;
        }

        return TestPrefixes(pStyle);
    },

	n4jive.opacitySupported = function(){
		var el = document.createElement("div");
		if(typeof el.style.opacity == "string"){
			return true;
		}else{ 
			return false;
		}
	},
	
    /////*****/////*****/////*****/////*****
    /////*****  UPDATE SERVICE
    /////*****/////*****/////*****/////*****
    n4jive.callbacks = [], // array containing the callback information for any widget slaved to update.

    /**
     *  Durring the init phase of the widget, in addition to creating help and loading blocks, a function may be
     *  supplied to it's parent (here) that can be looked up when other widgets have signnaled that they have made
     *  a change.
     */
    n4jive.registerUpdate = function(pCallback) {
        if(typeof(pCallback) == 'function') {
            this.callbacks.push(pCallback);
        }
    },

    /**
     *  Simply itterates through the array of callbacks we have and calls each and every one.
     */
    n4jive.runUpdates = function() {
        if(this.callbacks.length > 0) {
            for (var item in this.callbacks) {
                this.callbacks[item]();
            }
        }
    },
	
    /**
     *  Encodes an ISO-8859-1 string to UTF-8
     *
     *  This is a modified method from the the php.js project which implemented the original.
     *      Project Site: hhttp://phpjs.org
     *      original by: Webtoolkit.info (http://www.webtoolkit.info/)
     *      php.js is copyright 2011 Kevin van Zonneveld.
     *      Version: 3.26
     *      Dual licensed under the MIT and GPL licenses.
     *      http://phpjs.org/pages/license
     *
     *  @param      {string} Data to encode
     *  @returns    {string} Encoded String
     */
    n4jive.utf8_encode = function(argString) {
        if (argString === null || typeof argString === "undefined") {
            return "";
        }
        var string = (argString + ''); // .replace(/\r\n/g, "\n").replace(/\r/g, "\n");
        var utftext = "",
            start, end, stringl = 0;

        start = end = 0;    stringl = string.length;
        for (var n = 0; n < stringl; n++) {
            var c1 = string.charCodeAt(n);
            var enc = null;
             if (c1 < 128) {
                end++;
            } else if (c1 > 127 && c1 < 2048) {
                enc = String.fromCharCode((c1 >> 6) | 192) + String.fromCharCode((c1 & 63) | 128);
            } else {
                enc = String.fromCharCode((c1 >> 12) | 224) + String.fromCharCode(((c1 >> 6) & 63) | 128) + String.fromCharCode((c1 & 63) | 128);
            }
            if (enc !== null) {
                if (end > start) {
                    utftext += string.slice(start, end);
                }
                utftext += enc;
                start = end = n + 1;
            }
        }
        if (end > start) {
            utftext += string.slice(start, stringl);
        }
        return utftext;
    }

    /**
     *  @param      {string} Data to encode
     *  @returns    {string} Encoded String
     */
    n4jive.encode64 = function(pInput) {
        var input = encodeURIComponent(pInput);
        var output = '';
        var chr1, chr2, chr3, enc1, enc2, enc3, enc4 = "";
        var i = 0;
        do {
            chr1 = input.charCodeAt(i++);
            chr2 = input.charCodeAt(i++);
            chr3 = input.charCodeAt(i++);
            enc1 = chr1 >> 2;
            enc2 = ((chr1 & 3) << 4) | (chr2 >> 4);
            enc3 = ((chr2 & 15) << 2) | (chr3 >> 6);
            enc4 = chr3 & 63;

            if (isNaN(chr2)) {
                enc3 = enc4 = 64;
            } else if (isNaN(chr3)) {
                enc4 = 64;
            }

            output = output +
            this.keyString.charAt(enc1) +
            this.keyString.charAt(enc2) +
            this.keyString.charAt(enc3) +
            this.keyString.charAt(enc4);
            chr1 = chr2 = chr3 = "";
            enc1 = enc2 = enc3 = enc4 = "";
        } while (i < input.length);
        return output;
    }

	n4jive.getOrdinal = function(n){
	   var s=["th","st","nd","rd"],
	       v=n%100;
	   return n+(s[(v-20)%10]||s[v]||s[0]);
	}
	
	n4jive.log = function(m){
		console.log(m)
	}
	
	n4jive.getUserId = function(context){
		return context.nitro.connectionParams.userId;
	}
	
	n4jive.getOption = function(opt, context){
		if(context.options[opt]){
			return context.options[opt];
		}else{
			return false;
		}
	}
	
	/**
	 * n4jive.sidebarTeamLeaders.getSessionKey()
	 * convenience function to return our sessionKey
	 * @return - a nitro session key for the passed-in nitro object
	 */	
	n4jive.getSessionKey = function(context){
		return context.nitro.connectionParams.sessionKey;			
	}
	
	/**
	 * n4jive.sidebarTeamLeaders.getPointCategory()
	 * convenience function to return the passed in point Category
	 * @return - the provided point category || "Points"
	 */	
	n4jive.getPointCategory = function(){
		if(typeof options.pointCategory != 'undefined'){
			return options.pointCategory;
		}
		return "Points"
	}


    var locale_map = {
        'cs': 'cs-CZ',
        'da': 'da-DK',
        'de': 'de-DE',
        'en': 'en-US',
        'es': 'es-ES',
        'fi': 'fi-FI',
        'fr': 'fr-FR',
        'hu': 'hu-HU',
        'it': 'it-IT',
        'ja': 'ja-JP',
        'ko': 'ko-KR',
        'nl': 'nl-NL',
        'no': 'nb-NO',
        'pl': 'pl-PL',
        'pt': 'pt-PT',
        'ru': 'ru-RU',
        'sv': 'sv-SE',
        'th': null, // there is not match
        'zh': 'zh-CN',
        'zh-CN': 'zh-CN',
        'zh_CN': 'zh-CN'
    };

    n4jive.locale = function (enabled) {
        if (enabled) {
            var pageLocale = $('html').attr('lang');
            return locale_map[pageLocale];
        }
        else {
            return null;
        }
    };


    n4jive.buildLocaleString = function(locale) {
        if (locale) {
            return "&locale=" + locale;
        }
        else {
            return "";
        }
    };

    n4jive.localeString = function(enabled) {
        var locale = n4jive.locale(enabled);
        return n4jive.buildLocaleString(locale);
    };

    n4jive.extendWithLocale = function (hash, locale) {
        if (locale) {
            return _.extend(hash, {locale: locale});
        }
        else {
            return hash;
        }
    };

    return n4jive;
});

//if (typeof n4jive.workingFactory == 'undefined'){
//	n4jive.workingFactory = function(pTarget) {
//        var working = $('<div/>', { "class" : "nitro-widget-loading" });
//
//        var topOffset = (pTarget.height() / 2) - 70;
//
//        working.append(
//            $('<div/>', { "class" : "loading-icon" }).css('top', (topOffset < 0 ? 0 : topOffset)).css('margin-left', (pTarget.width() - 50) / 2).append(
//                $('<img/>', { "src" : "https://assets.bunchball.net/widgets/jiveTest/images/ajax-loader.gif", "width" : "50", "height" : "50" })
//            )
//        )
//
//        pTarget.prepend(working);
//
//        return function(){
//            working.detach();
//        };
//    }
//}
