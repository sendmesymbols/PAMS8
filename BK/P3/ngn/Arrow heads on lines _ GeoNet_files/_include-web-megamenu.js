/* -------------------------------------------------------

    MEGA MENU WEB VERSION INCLUDE
    last updated: June 2014 CH

------------------------------------------------------- */

var includes = '<meta http-equiv="X-UA-Compatible" content="IE=edge">',
projectName = "Apps/MegaMenu/",
//web_dir = '//webapps-cdn.esri.com/CDN/'+projectName+'/'; //add directory and name from CDN folder
//web_dir = "";
//web_dir = '//webapps-cdn.esri.com/Apps/MegaMenu/'; //add directory and name from CDN folder

web_dir = '//webapps-cdn-dev.esri.com/Apps/MegaMenu/';
//var tier = 'dev';

var tier = 'prd';
var scripts = [];

switch(location.hostname){
  case 'localhost':
  case 'cmsdev.esri.com':
  case 'webapps-cdn-dev.esri.com':
  case 'supportdev.esri.com':
  case 'mydev.esri.com':
  case 'trainingdev.esri.com':
  case 'accounts-dev.esri.com':
    web_dir = "//webapps-cdn-dev.esri.com/"+projectName;
    tier = 'dev';
  break;

  case 'webapps-cdn-stg.esri.com':
  case 'myqa.esri.com':
  case 'accounts-stg.esri.com':
  //jive community
  case 'esri-preview.jiveon.com':
  case 'community-qa.esri.com':
    web_dir = "//webapps-cdn-stg.esri.com/"+projectName;
    scripts.push("MegaMenuLogin.js");
	tier = 'stg';
  break;

  case 'localhost':
    web_dir = "//"+location.hostname+":"+location.port+"/Esri-Mega-Menu/";
  break;
}

function getQueryVariable(variable)
{
       var query = window.location.search.substring(1);
       var vars = query.split("&");
       for (var i=0;i<vars.length;i++) {
               var pair = vars[i].split("=");
               if(pair[0] == variable){return pair[1];}
       }
       return(false);
}


/*if(getQueryVariable('login')){
	scripts.push("MegaMenuLogin.js");
}*/
if (typeof jQuery == 'undefined') {
   scripts.push("libs/jquery-1.10.2.min.js");
}
if (typeof Craydent == 'undefined') {
   scripts.push("libs/craydent-1.7.27.js");
}
if (typeof Modernizr == 'undefined') {
   scripts.push("libs/modernizr.js");
}

scripts.push(
  "MegaMenuLogin.js",
  "MegaMenuBuilder.jquery.js",
  "jquery.megamenu.js"
);


var scripts_dir = web_dir+"js/";

var
styles_dir = web_dir+"css/",
styles =[];
styles.push(
  "megamenu.css"
);
var
script,style,sc,st,
sc_len = scripts.length,st_len = styles.length;

//scripts
for(sc = 0; sc < sc_len; sc++){
  script = scripts[sc];
  includes+='<script type="text/javascript" src="'+scripts_dir+script+'"></script>';
}
//styles
for(st = 0; st < st_len; st++){
  style = styles[st];
  includes+='<link href="'+styles_dir+style+'" rel="stylesheet" type="text/css">';
}

//add custom tags elements
includes+=
	'<link href="//fast.fonts.com/cssapi/23855eec-5fdf-4594-9898-0113a04bfef0.css" rel="stylesheet" type="text/css" />' +
	'<link rel="stylesheet" href="//webapps-cdn.esri.com/CDN/components/responsive/css/centurion-grid.css">'+
  '<link rel="stylesheet" href="//webapps-cdn.esri.com/CDN/components/responsive/css/centurion-grid_v2.min.css">'+
  '<!--[if (lt IE 9) & (!IEMobile)]>'+
  '<link rel="stylesheet" href="//www.esri.com/components/responsive/css/centurion-grid-ie.min.css">'+
  '<![endif]-->'+
  '<script src="//webapps-cdn.esri.com/CDN/esri-core/analytics.js"></script>';
//  '<script src="https://s3-us-west-1.amazonaws.com/patterns.esri.com/special/ptm-domains.js"></script>'+
//  '<script src="https://s3.amazonaws.com/webapps.esri.com/configs/adobeAnalyticsScript.js"></script>'+
//  '<script src="https://s3.amazonaws.com/webapps.esri.com/PardotTagManager/PardotTagManager.js"></script>';

// Include code only on DEV or STG for testing
if (tier == 'dev' || tier == 'stg') {
  includes+= '';
}

document.write(includes);
