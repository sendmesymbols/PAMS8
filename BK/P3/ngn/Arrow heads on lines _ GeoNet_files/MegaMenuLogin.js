// Mega Menu Login

function MegaMenuLogin(specs){
	var self = this;
	this.user = {};
/*	var jivelinks = ["community.esri.com","community-qa.esri.com","geonet.esri.com"];
	 if(jivelinks.indexOf(location.hostname) != -1 && __mml.user.token){*/

	var tier = specs.tier || 'prd';

	var links = {
		'dev':'accounts-dev.esri.com',
		'stg':'accounts-stg.esri.com',
		'prd':'accounts.esri.com'
	};

    //for geonet
    var geonetlinks = {
        'dev':'community-qa.esri.com',
        'stg':'community-qa.esri.com',
        'prd':'geonet.esri.com'
    };

	var jivelinks = ["community.esri.com","community-qa.esri.com","geonet.esri.com"];

  if(jivelinks.indexOf(location.hostname) != -1){
    // DEV / STG : https://community-qa.esri.com/logout.jspa
    // PRD : https://geonet.esri.com/logout.jspa
    if(location.hostname == "community-qa.esri.com") {
      this.signoutURL = 'https://community-qa.esri.com/logout.jspa'+'?redirect_uri='+location.href;
    } else {
      this.signoutURL = 'https://geonet.esri.com/logout.jspa'+'?redirect_uri='+location.href;
    }
  } else {
  	// DEV / STG : https://accounts-stg.esri.com/logout
    // PRD : https://acounts.esri.com/logout
    this.signoutURL = 'https://accounts.esri.com/logout'+'?redirect_uri='+location.href;
  }

/******** MyEsri ******/
	var myEsriTier = tier;
	var myEsriUrls = 'mylocal.esri.com,mydev.esri.com,myqa.esri.com,mystg.esri.com,my.esri.com';

	var myEsriLinks = {
		"local" :   "http://mylocal.esri.com:3000",
		"dev"   :   "https://mydev.esri.com",
		"qa"    :   "https://myqa.esri.com",
		"prd"   :   "https://my.esri.com"
	};

	if(myEsriUrls.indexOf(location.hostname) != -1){

		if ('mylocal.esri.com:3000'.indexOf(location.hostname) != -1) {
			myEsriTier = "local";
		} else if ('mydev.esri.com'.indexOf(location.hostname) != -1) {
			myEsriTier = "dev";
		} else if ('myqa.esri.com'.indexOf(location.hostname) != -1) {
			myEsriTier = "qa";
		} else if ('my.esri.com'.indexOf(location.hostname) != -1) {
			myEsriTier = "prd";
		}

		if(myEsriTier == "prd") {
			this.signoutURL = 'https://accounts.esri.com/logout'+'?redirect_uri='+location.href;
		} else {
			this.signoutURL = 'https://accounts-stg.esri.com/logout'+'?redirect_uri='+location.href;
		}
	}
/**********************/

/******** EsriU ******/
	var esriUUrls = 'mylocal.esri.com,esriudev.esri.com,esriuqa.esri.com,training.esri.com';

	if(esriUUrls.indexOf(location.hostname) != -1) {

		tier = "stg";

		this.signoutURL = 'https://accounts-stg.esri.com/logout'+'?redirect_uri='+location.href;

		if ('training.esri.com'.indexOf(location.hostname) != -1) {

			tier = "prd";

			this.signoutURL = 'https://accounts.esri.com/logout'+'?redirect_uri='+location.href;

		}

	}
/**********************/



  if(false && jivelinks.indexOf(location.hostname) != -1) {//for JIVE
      //this.signinURL = 'https://' + geonetlinks[tier] + '/' + '?redirect_uri=' + location.href;
      this.signinURL = 'https://' + geonetlinks[tier] + '/login.jspa?ssologin=true&fragment=&redirect_uri=' + location.href;
      //https://geonet.esri.com/login.jspa?ssologin=true&fragment=&
  }else{//for everyone else
      this.signinURL = 'https://' + links[tier] + '/' + '?redirect_uri=' + location.href;
  }
  //this.signinURL = 'https://'+links[tier]+'/'+'?redirect_uri='+location.href;
  //this.signoutURL = 'https://accounts-dev.esri.com/logout'+'?redirect_uri='+location.href;

	this.render=function(printToScreen){

		var user = self.user;
		var html = '';
		if(self.checkCookieToken()){
			html = '<div id="header-login">\
			  <!-- HEADER LOGIN -->\
			  <div id="logged-in-navigation" class="dropdown-navigation dropdown-wrapper">\
				<a class="dropdown small light">\
				  <span id="username">'+user.firstName+'</span>\
				</a>\
				<div class="dropdown-content">\
				  <ul>\
					<li>\
					  <a id="profileLink" href="' + myEsriLinks[myEsriTier] +'/#/profile/info">\
						<img id="dropdown-image" width="36" height="36" alt="" src="'+(user.imageURL||'http://www.gravatar.com/avatar/d7970fec8803bdbeeb5d82674a1a2c8b.jpg')+'">\
						<span class="profile-info">'+user.firstName+' '+user.lastName+'<br/>'+user.userName+'</span><br/>\
					  </a>\
					</li>\
					<li class="account-links">\
					  <a href="' + myEsriLinks[myEsriTier] +'/#/">My Esri</a>'
				// +'<a href="https://community-qa.esri.com">Community</a>'
			+'<a href="https://www.arcgis.com/">ArcGIS Online <span class="link-out"></span></a>\
					</li>\
					<li id="sign-out">\
					  <a href="'+self.signoutURL+'">Sign Out</a>\
					</li>\
				  </ul>\
				</div>\
			  </div>\
			  <!-- End of HEADER LOGIN -->\
			</div>';
		}
		else{
			html +=
			'<div id="logged-out-navigation" class="dropdown-navigation dropdown-wrapper">\
				<a class="dropdown small light" href="'+self.signinURL+'">\
				  <span id="username">Sign In</span>\
				</a>\
			</div>';
		}
		if(printToScreen){
			document.write(html);
		}
		return html;
	};

	this.readCookie = function(name){
		var nameEQ = name + "=";
		var ca = document.cookie.split(';');
		for(var i=0;i < ca.length;i++) {
			var c = ca[i];
			while (c.charAt(0)==' ') c = c.substring(1,c.length);
			if (c.indexOf(nameEQ) == 0) return c.substring(nameEQ.length,c.length);
		}
		return null;
	};

	this.checkCookieToken = function(){

		//var cookie = self.readCookie('esri_auth');
		var cookie = $COOKIE('esri_auth');
		if(cookie && typeof cookie != 'object'){
			try{
			cookie = eval('('+cookie+')');
			}catch(e){
				cookie = eval('('+decodeURIComponent(cookie)+')');
			}
		}
		if(cookie && cookie.token){
			self.user = cookie;
			return true;
		}else{
			return false;
		}
	};
	this.checkCookieToken();
	return this;
}
