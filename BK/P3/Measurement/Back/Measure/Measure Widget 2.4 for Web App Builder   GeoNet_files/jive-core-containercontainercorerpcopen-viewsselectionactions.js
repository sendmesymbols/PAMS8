window['___jsl'] = window['___jsl'] || {};(window['___jsl']['ci'] = (window['___jsl']['ci'] || [])).push({"container":{"relayPath":"https://community.esri.com/gadgets/files/container/rpc_relay.html","jsPath":"/gadgets/js","enableRpcArbitration":false},"core.io":{"unparseableCruft":"throw 1; \u003c don't be evil' \u003e","jsPath":"/gadgets/js","xhrPollIntervalMs":50,"jsonProxyUrl":"https://%host%/gadgets/makeRequest","proxyUrl":"https://%host%/gadgets/proxy?container=default&refresh=%refresh%&url=%url%%authz%%rewriteMime%"},"osapi.services":{"https://%host%/social/rpc":["jive.market.installMultiAppNonTransactional","jive.core.delete","jive.market.requestAppSync","albums.create","http.head","gadgets.token","activitystreams.supportedFields","jive.market.getSbsContext","activities.create","http.get","jive.market.installMultiApp","jive.core.patch","jive.version.getVersionInfo","mediaItems.delete","jive.ext.delete","people.get","jive.connects.get","jive.connects.reset","gadgets.supportedFields","gadgets.cajaSupportedFields","systemSettings.update","jive.market.installApp","jive.connects.delete","jive.core.get","mediaItems.update","groups.update","jive.market.uninstallApp","http.put","appdata.create","activitystreams.delete","http.delete","cache.invalidate","application.get","jive.connects.patch","systemSettings.create","jive.ext.post","jive.market.isCachingEnabled","albums.delete","groups.supportedFields","messages.delete","jive.connects.head","appdata.update","jive.ext.put","groups.create","people.update","activities.supportedFields","jive.connects.put","jive.connects.post","http.post","albums.get","jive.market.refreshApp","gadgets.proxySupportedFields","gadgets.cajole","people.supportedFields","jive.dev.isCachingEnabled","gadgets.metadata","jive.binary.metadata","albums.supportedFields","albums.update","activities.delete","mediaItems.get","groups.get","jive.core.post","jive.dev.setCachingEnabled","jive.market.setCachingEnabled","gadgets.proxy","activities.update","jive.connects.pooled","jive.binary.token","activitystreams.create","activitystreams.get","jive.connects.connection","jive.core.put","jive.ext.patch","jive.connects.update","messages.get","activitystreams.update","jive.market.getAppInstances","mediaItems.create","messages.create","gadgets.jsSupportedFields","systemSettings.delete","groups.delete","jive.connects.configuration","gadgets.tokenSupportedFields","activities.get","gadgets.js","jive.ext.get","appdata.get","appdata.delete","systemSettings.get","jive.market.publishExtension","jive.connects.statistics","system.listMethods"]},"opensocial":{"path":"https://%host%/social/rpc","invalidatePath":"https://community.esri.com/gadgets/api/rpc","domain":"shindig","enableCaja":false,"supportedFields":{"activity":["appId","body","bodyId","externalId","id","mediaItems","postedTime","priority","streamFaviconUrl","streamSourceUrl","streamTitle","streamUrl","templateParams","title","url","userId"],"person":["id",{"name":["familyName","givenName","unstructured"]},"emails","thumbnailUrl","profileUrl","aboutMe","hasApp","photos","jive_enabled"],"album":["id","thumbnailUrl","title","description","location","ownerId"],"mediaItem":["album_id","created","description","duration","file_size","id","language","last_updated","location","mime_type","num_comments","num_views","num_votes","rating","start_time","tagged_people","tags","thumbnail_url","title","type","url"],"group":["id","title","description"],"activityEntry":["actor","content","generator","icon","id","object","published","provider","target","title","updated","url","verb","openSocial","extensions"]}},"rpc":{"useLegacyProtocol":false,"commSwf":"https://community.esri.com/gadgets/xpc.swf","passReferrer":"c2p:query","parentRelayUrl":"/gadgets/ifpc.relay.html"},"osapi":{"endPoints":["https://%host%/social/rpc"]},"views":{"default":{"aliases":["DEFAULT","profile"],"urlTemplate":"https://community.esri.com/gadgets/default?{var}","isOnlyVisible":false},"canvas":{"aliases":["FULL_PAGE"],"urlTemplate":"https://community.esri.com/gadgets/canvas?{var}","isOnlyVisible":true},"system-settings":{"isOnlyVisible":true},"about":{"isOnlyVisible":false},"user-prefs":{"isOnlyVisible":true},"embedded":{"isOnlyVisible":true},"home":{"aliases":["HOME"],"urlTemplate":"https://community.esri.com/gadgets/home?{var}","isOnlyVisible":false}}});window['___jsl'] = window['___jsl'] || {};window['___jsl']['f'] = ['actions','auth-refresh','container','container.site','container.site.gadget','container.site.url','container.util','core','core.config','core.config.base','core.io','core.json','core.legacy','core.log','core.prefs','core.util','core.util.base','core.util.dom','core.util.event','core.util.onload','core.util.string','core.util.urlparams','embedded-experiences','gadgets.json.ext','globals','jive-core-container','locked-domain','open-views','open-views.common','open-views.ee','open-views.gadget','open-views.results','open-views.url','opensocial','opensocial-base','opensocial-data-context','opensocial-jsonrpc','opensocial-reference','osapi','osapi.base','rpc','security-token','selection','shindig.auth','shindig.uri','shindig.uri.ext','taming','views','xmlutil'];
/* [start] feature=globals */
gadgets=window.gadgets||{};
shindig=window.shindig||{};
osapi=window.osapi||{};;

/* [end] feature=globals */

/* [start] feature=taming */
var safeJSON=window.safeJSON;
var tamings___=window.tamings___||[];
var bridge___;
var caja___=window.caja___;
var ___=window.___;;

/* [end] feature=taming */

/* [start] feature=core.config.base */
if(!window.gadgets["config"]){gadgets.config=function(){var h;
var i={};
var b={};
var d=false;
function c(k,m){for(var l in m){if(!m.hasOwnProperty(l)){continue
}if(typeof k[l]==="object"&&typeof m[l]==="object"){c(k[l],m[l])
}else{k[l]=m[l]
}}}function j(){var q=(b["core.io"]||{})["jsPath"]||null,p=[],s=0;
var l=document.scripts||document.getElementsByTagName("script");
if(!l||l.length==0){return p
}for(var m=0;
m<l.length;
++m){var r=l[m].src,o=q!=null&&r&&r.indexOf(q)||-1;
if(o!=-1&&/.*[.]js.*[?&]c=[01](#|&|$).*/.test(r.substring(o+q.length))){p[s++]=l[m]
}}if(!p.length){var k=l[l.length-1];
if(k.src){p[0]=k
}}return p
}function a(k){var l="";
if(k.nodeType==3||k.nodeType==4){l=k.nodeValue
}else{if(k.innerText){l=k.innerText
}else{if(k.innerHTML){l=k.innerHTML
}else{if(k.firstChild){var m=[];
for(var n=k.firstChild;
n;
n=n.nextSibling){m.push(a(n))
}l=m.join("")
}}}}return l
}function f(l){var k;
try{k=(new Function("return ("+l+"\n)"))()
}catch(m){}if(typeof k==="object"){return k
}try{k=(new Function("return ({"+l+"\n})"))()
}catch(m){}return typeof k==="object"?k:{}
}function g(q){var k=j();
if(!k.length){return
}for(var p=0;
p<k.length;
p++){var m=a(k[p]);
var l=f(m);
if(h.f&&h.f.length==1){var o=h.f[0];
if(!l[o]){var n={};
n[h.f[0]]=l;
l=n
}}c(q,l);
var r=window.___cfg;
if(r){c(q,r)
}}}function e(o){for(var l in i){if(i.hasOwnProperty(l)){var n=i[l];
for(var m=0,k=n.length;
m<k;
++m){o(l,n[m])
}}}}return{register:function(m,l,k,n){var o=i[m];
if(!o){o=[];
i[m]=o
}o.push({validators:l||{},callback:k,callOnUpdate:n});
if(d&&k){k(b)
}},get:function(k){if(k){return b[k]||{}
}return b
},init:function(l,k){h=window.___jsl||{};
c(b,l);
g(b);
var m=window.___config||{};
c(b,m);
e(function(r,q){var p=b[r];
if(p&&!k){var n=q.validators;
for(var o in n){if(n.hasOwnProperty(o)){if(!n[o](p[o])){throw new Error('Invalid config value "'+p[o]+'" for parameter "'+o+'" in component "'+r+'"')
}}}}if(q.callback){q.callback(b)
}});
d=true
},update:function(k,o){var n=[];
e(function(q,p){if(k.hasOwnProperty(q)||(o&&b&&b[q])){if(p.callback&&p.callOnUpdate){n.push(p.callback)
}}});
b=o?{}:b||{};
c(b,k);
for(var m=0,l=n.length;
m<l;
++m){n[m](b)
}},clear:function(){gadgets.warn("This method is for testing.");
var k;
h=k;
b={};
d=false
}}
}()
};;

/* [end] feature=core.config.base */

/* [start] feature=core.log */
gadgets.log=(function(){var e=1;
var a=2;
var f=3;
var c=4;
var d=function(i){b(e,i)
};
gadgets.warn=function(i){b(a,i)
};
gadgets.error=function(i){b(f,i)
};
gadgets.setLogLevel=function(i){h=i
};
function b(j,i){if(typeof g==="undefined"){g=window.console?window.console:window.opera?window.opera.postError:null
}if(j<h||!g){return
}if(j===a&&g.warn){g.warn(i)
}else{if(j===f&&g.error){g.error(i)
}else{if(g.log){g.log(i)
}}}}d.INFO=e;
d.WARNING=a;
d.NONE=c;
var h=e;
var g;
return d
})();;

/* [end] feature=core.log */

/* [start] feature=core.config */
(function(){gadgets.config.EnumValidator=function(d){var c=[];
if(arguments.length>1){for(var b=0,a;
(a=arguments[b]);
++b){c.push(a)
}}else{c=d
}return function(f){for(var e=0,g;
(g=c[e]);
++e){if(f===c[e]){return true
}}return false
}
};
gadgets.config.RegExValidator=function(a){return function(b){return a.test(b)
}
};
gadgets.config.ExistsValidator=function(a){return typeof a!=="undefined"
};
gadgets.config.NonEmptyStringValidator=function(a){return typeof a==="string"&&a.length>0
};
gadgets.config.BooleanValidator=function(a){return typeof a==="boolean"
};
gadgets.config.LikeValidator=function(a){return function(c){for(var d in a){if(a.hasOwnProperty(d)){var b=a[d];
if(!b(c[d])){return false
}}}return true
}
}
})();;

/* [end] feature=core.config */

/* [start] feature=core.util.base */
gadgets.util=gadgets.util||{};
gadgets.util.makeClosure=function(d,f,e){var c=[];
for(var b=2,a=arguments.length;
b<a;
++b){c.push(arguments[b])
}return function(){var g=c.slice();
for(var k=0,h=arguments.length;
k<h;
++k){g.push(arguments[k])
}return f.apply(d,g)
}
};
gadgets.util.makeEnum=function(b){var c,a,d={};
for(c=0;
(a=b[c]);
++c){d[a]=a
}return d
};
gadgets.util.shouldPollXhrReadyStateChange=function(){if(document.all&&!document.querySelector){return true
}return Boolean(/Trident\/4(\.\d+)?;/.exec(navigator.userAgent))
};;

/* [end] feature=core.util.base */

/* [start] feature=core.util.dom */
gadgets.util=gadgets.util||{};
(function(){var b="http://www.w3.org/1999/xhtml";
function a(e,d){var g=d||{};
for(var f in g){if(g.hasOwnProperty(f)){e[f]=g[f]
}}}function c(f,e){var d=["<",f];
var h=e||{};
for(var g in h){if(h.hasOwnProperty(g)){d.push(" ");
d.push(g);
d.push('="');
d.push(gadgets.util.escapeString(h[g]));
d.push('"')
}}d.push("></");
d.push(f);
d.push(">");
return d.join("")
}gadgets.util.createElement=function(e){var d;
if((!document.body)||document.body.namespaceURI){try{d=document.createElementNS(b,e)
}catch(f){}}return d||document.createElement(e)
};
gadgets.util.createIframeElement=function(f){var h=gadgets.util.createElement("iframe");
try{var d=c("iframe",f);
var e=gadgets.util.createElement(d);
if(e&&((!h)||((e.tagName==h.tagName)&&(e.namespaceURI==h.namespaceURI)))){h=e
}}catch(g){}a(h,f);
return h
};
gadgets.util.getBodyElement=function(){if(document.body){return document.body
}try{var e=document.getElementsByTagNameNS(b,"body");
if(e&&(e.length==1)){return e[0]
}}catch(d){}return document.documentElement||document
}
})();;

/* [end] feature=core.util.dom */

/* [start] feature=core.util.event */
gadgets.util=gadgets.util||{};
gadgets.util.attachBrowserEvent=function(c,b,d,a){if(typeof c.addEventListener!="undefined"){c.addEventListener(b,d,a)
}else{if(typeof c.attachEvent!="undefined"){c.attachEvent("on"+b,d)
}else{gadgets.warn("cannot attachBrowserEvent: "+b)
}}};
gadgets.util.removeBrowserEvent=function(c,b,d,a){if(c.removeEventListener){c.removeEventListener(b,d,a)
}else{if(c.detachEvent){c.detachEvent("on"+b,d)
}else{gadgets.warn("cannot removeBrowserEvent: "+b)
}}};;

/* [end] feature=core.util.event */

/* [start] feature=core.util.onload */
gadgets.util=gadgets.util||{};
(function(){var a=[];
gadgets.util.registerOnLoadHandler=function(b){a.push(b)
};
gadgets.util.runOnLoadHandlers=function(){gadgets.util.registerOnLoadHandler=function(e){e()
};
for(var d=0,b=a.length;
d<b;
++d){try{a[d]()
}catch(c){gadgets.warn("Could not fire onloadhandler "+c.message)
}}a=undefined
}
})();;

/* [end] feature=core.util.onload */

/* [start] feature=core.util.string */
gadgets.util=gadgets.util||{};
(function(){var a={0:false,10:true,13:true,34:true,39:true,60:true,62:true,92:true,8232:true,8233:true,65282:true,65287:true,65308:true,65310:true,65340:true};
function b(c,d){return String.fromCharCode(d)
}gadgets.util.escape=function(c,g){if(!c){return c
}else{if(typeof c==="string"){return gadgets.util.escapeString(c)
}else{if(typeof c==="array"){for(var f=0,d=c.length;
f<d;
++f){c[f]=gadgets.util.escape(c[f])
}}else{if(typeof c==="object"&&g){var e={};
for(var h in c){if(c.hasOwnProperty(h)){e[gadgets.util.escapeString(h)]=gadgets.util.escape(c[h],true)
}}return e
}}}}return c
};
gadgets.util.escapeString=function(g){if(!g){return g
}var d=[],f,h;
for(var e=0,c=g.length;
e<c;
++e){f=g.charCodeAt(e);
h=a[f];
if(h===true){d.push("&#",f,";")
}else{if(h!==false){d.push(g.charAt(e))
}}}return d.join("")
};
gadgets.util.unescapeString=function(c){if(!c){return c
}return c.replace(/&#([0-9]+);/g,b)
}
})();;

/* [end] feature=core.util.string */

/* [start] feature=core.util.urlparams */
gadgets.util=gadgets.util||{};
(function(){var a=null;
function b(e){var f;
var c=e.indexOf("?");
var d=e.indexOf("#");
if(d===-1){f=e.substr(c+1)
}else{f=[e.substr(c+1,d-c-1),"&",e.substr(d+1)].join("")
}return f.split("&")
}gadgets.util.getUrlParameters=function(p){var d=typeof p==="undefined";
if(a!==null&&d){return a
}var l={};
var f=b(p||document.location.href);
var n=window.decodeURIComponent?decodeURIComponent:unescape;
for(var h=0,g=f.length;
h<g;
++h){var m=f[h].indexOf("=");
if(m===-1){continue
}var c=f[h].substring(0,m);
var o=f[h].substring(m+1);
o=o.replace(/\+/g," ");
try{l[c]=n(o)
}catch(k){}}if(d){a=l
}return l
}
})();
gadgets.util.getUrlParameters();;

/* [end] feature=core.util.urlparams */

/* [start] feature=core.util */
gadgets.util=gadgets.util||{};
(function(){var b={};
var a={};
function c(d){b=d["core.util"]||{}
}if(gadgets.config){gadgets.config.register("core.util",null,c)
}gadgets.util.getFeatureParameters=function(d){return typeof b[d]==="undefined"?null:b[d]
};
gadgets.util.hasFeature=function(d){return typeof b[d]!=="undefined"
};
gadgets.util.getServices=function(){return a
}
})();;

/* [end] feature=core.util */

/* [start] feature=core.json */
if(window.JSON&&window.JSON.parse&&window.JSON.stringify){gadgets.json=(function(){var a=/___$/;
function b(d,e){var c=this[d];
return c
}return{parse:function(d){try{return window.JSON.parse(d)
}catch(c){return false
}},stringify:function(d){var h=window.JSON.stringify;
function f(e){return h.call(this,e,b)
}var g=(Array.prototype.toJSON&&h([{x:1}])==='"[{\\"x\\": 1}]"')?f:h;
try{return g(d,function(i,e){return !a.test(i)?e:void 0
})
}catch(c){return null
}}}
})()
};;
if(!(window.JSON&&window.JSON.parse&&window.JSON.stringify)){gadgets.json=function(){function f(n){return n<10?"0"+n:n
}Date.prototype.toJSON=function(){return[this.getUTCFullYear(),"-",f(this.getUTCMonth()+1),"-",f(this.getUTCDate()),"T",f(this.getUTCHours()),":",f(this.getUTCMinutes()),":",f(this.getUTCSeconds()),"Z"].join("")
};
var m={"\b":"\\b","\t":"\\t","\n":"\\n","\f":"\\f","\r":"\\r",'"':'\\"',"\\":"\\\\"};
function stringify(value){var a,i,k,l,r=/[\"\\\x00-\x1f\x7f-\x9f]/g,v;
switch(typeof value){case"string":return r.test(value)?'"'+value.replace(r,function(a){var c=m[a];
if(c){return c
}c=a.charCodeAt();
return"\\u00"+Math.floor(c/16).toString(16)+(c%16).toString(16)
})+'"':'"'+value+'"';
case"number":return isFinite(value)?String(value):"null";
case"boolean":case"null":return String(value);
case"object":if(!value){return"null"
}a=[];
if(typeof value.length==="number"&&!value.propertyIsEnumerable("length")){l=value.length;
for(i=0;
i<l;
i+=1){a.push(stringify(value[i])||"null")
}return"["+a.join(",")+"]"
}for(k in value){if(/___$/.test(k)){continue
}if(value.hasOwnProperty(k)){if(typeof k==="string"){v=stringify(value[k]);
if(v){a.push(stringify(k)+":"+v)
}}}}return"{"+a.join(",")+"}"
}return""
}return{stringify:stringify,parse:function(text){if(/^[\],:{}\s]*$/.test(text.replace(/\\["\\\/b-u]/g,"@").replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g,"]").replace(/(?:^|:|,)(?:\s*\[)+/g,""))){return eval("("+text+")")
}return false
}}
}()
};;
gadgets.json.flatten=function(c){var d={};
if(c===null||typeof c=="undefined"){return d
}for(var a in c){if(c.hasOwnProperty(a)){var b=c[a];
if(null===b||typeof b=="undefined"){continue
}d[a]=(typeof b==="string")?b:gadgets.json.stringify(b)
}}return d
};;

/* [end] feature=core.json */

/* [start] feature=shindig.auth */
shindig.Auth=function(){var authToken=null;
var trusted=null;
function addParamsToToken(urlParams){var args=authToken.split("&");
for(var i=0;
i<args.length;
i++){var nameAndValue=args[i].split("=");
if(nameAndValue.length===2){var name=nameAndValue[0];
var value=nameAndValue[1];
if(value==="$"){value=encodeURIComponent(urlParams[name]);
args[i]=name+"="+value
}}}authToken=args.join("&")
}function init(configuration){var urlParams=gadgets.util.getUrlParameters();
var config=configuration["shindig.auth"]||{};
if(config.authToken){authToken=config.authToken
}else{if(urlParams.st){authToken=urlParams.st
}}if(authToken!==null){addParamsToToken(urlParams)
}if(config.trustedJson){trusted=eval("("+config.trustedJson+")")
}}gadgets.config.register("shindig.auth",null,init);
return{getSecurityToken:function(){return authToken
},updateSecurityToken:function(newToken){authToken=newToken
},getTrustedData:function(){return trusted
}}
};;
shindig.auth=new shindig.Auth();;

/* [end] feature=shindig.auth */

/* [start] feature=rpc */
gadgets.rpctx=gadgets.rpctx||{};
if(!gadgets.rpctx.wpm){gadgets.rpctx.wpm=function(){var e,d;
var c=true;
function b(h,i,g){if(typeof window.addEventListener!="undefined"){window.addEventListener(h,i,g)
}else{if(typeof window.attachEvent!="undefined"){window.attachEvent("on"+h,i)
}}}function a(h,i,g){if(window.removeEventListener){window.removeEventListener(h,i,g)
}else{if(window.detachEvent){window.detachEvent("on"+h,i)
}}}function f(h){var i=gadgets.json.parse(h.data);
if(!i||!i.f){return
}var g=gadgets.rpc.getTargetOrigin(i.f);
if(c&&(typeof h.origin!=="undefined"?h.origin!==g:h.domain!==/^.+:\/\/([^:]+).*/.exec(g)[1])){return
}e(i,h.origin)
}return{getCode:function(){return"wpm"
},isParentVerifiable:function(){return true
},init:function(h,i){function g(k){var j=k?k.rpc:{};
if(String(j.disableForceSecure)==="true"){c=false
}}gadgets.config.register("rpc",null,g);
e=h;
d=i;
b("message",f,false);
d("..",true);
return true
},setup:function(h,g){d(h,true);
return true
},call:function(h,k,j){var g=gadgets.rpc.getTargetOrigin(h);
var i=gadgets.rpc._getTargetWin(h);
if(g){window.setTimeout(function(){i.postMessage(gadgets.json.stringify(j),g)
},0)
}else{gadgets.error("No relay set (used as window.postMessage targetOrigin), cannot send cross-domain message")
}return true
}}
}()
};;
gadgets.rpctx=gadgets.rpctx||{};
if(!gadgets.rpctx.flash){gadgets.rpctx.flash=function(){var B="___xpcswf";
var s=null;
var k=false;
var l=null;
var I=null;
var w=null;
var J=100;
var t=50;
var C=[];
var b=null;
var o=500;
var K=null;
var a=0;
var x="_scr";
var g="_pnt";
var j=100;
var r=50;
var n=0;
var f=null;
var A={};
var E=window.location.protocol+"//"+window.location.host;
var p="___jsl";
var e="_fm";
var i;
function v(){window[p]=window[p]||{};
var M=window[p];
var N=M[e]={};
i=p+"."+e;
return N
}var m=v();
function L(O,M){var N=function(){O.apply({},arguments)
};
m[M]=m[M]||N;
return i+"."+M
}function q(M){return M===".."?gadgets.rpc.RPC_ID:M
}function F(M){return M===".."?"INNER":"OUTER"
}function H(M){if(k){s=M.rpc["commSwf"]||"//xpc.googleusercontent.com/gadgets/xpc.swf"
}}gadgets.config.register("rpc",null,H);
function y(){if(w===null&&document.body&&s){var O=s+"?cb="+Math.random()+"&origin="+E+"&jsl=1";
var N=document.createElement("div");
N.style.height="1px";
N.style.width="1px";
var M='<object height="1" width="1" id="'+B+'" type="application/x-shockwave-flash"><param name="allowScriptAccess" value="always"></param><param name="movie" value="'+O+'"></param><embed type="application/x-shockwave-flash" allowScriptAccess="always" src="'+O+'" height="1" width="1"></embed></object>';
document.body.appendChild(N);
N.innerHTML=M;
w=N.firstChild
}++a;
if(K!==null&&(w!==null||a>=t)){window.clearTimeout(K)
}else{K=window.setTimeout(y,J)
}}function D(){if(A[".."]){return
}z("..");
n++;
if(n>=r&&f!==null){window.clearTimeout(f);
f=null
}else{f=window.setTimeout(D,j)
}}function G(){if(w!==null&&w.setup){while(C.length>0){var N=C.shift();
var M=N.targetId;
w.setup(N.token,q(M),F(M))
}if(b!==null){window.clearTimeout(b);
b=null
}}else{if(b===null&&C.length>0){b=window.setTimeout(G,o)
}}}function h(){G();
if(K!==null){window.clearTimeout(K)
}K=null
}L(h,"ready");
function c(){if(!A[".."]&&f===null){f=window.setTimeout(D,j)
}}L(c,"setupDone");
function d(O,S,Q){var N=gadgets.rpc.getTargetOrigin(O);
var R=gadgets.rpc.getAuthToken(O);
var M="sendMessage_"+q(O)+"_"+R+"_"+F(O);
var P=w[M];
P.call(w,gadgets.json.stringify(Q),N);
return true
}function u(O,Q,P){var M=gadgets.json.parse(O);
var N=M[x];
if(N){I(N,true);
A[N]=true;
if(N!==".."){z(N,true)
}return
}window.setTimeout(function(){l(M,Q)
},0)
}L(u,"receiveMessage");
function z(P,O){var M=gadgets.rpc.RPC_ID;
var N={};
N[x]=O?"..":M;
N[g]=M;
d(P,M,N)
}return{getCode:function(){return"flash"
},isParentVerifiable:function(){return true
},init:function(N,M){l=N;
I=M;
k=true;
return true
},setup:function(N,M){C.push({token:M,targetId:N});
if(w===null&&K===null){K=window.setTimeout(y,J)
}G();
return true
},call:d,_receiveMessage:u,_ready:h,_setupDone:c}
}()
};;
gadgets.rpctx=gadgets.rpctx||{};
if(!gadgets.rpctx.frameElement){gadgets.rpctx.frameElement=function(){var e="__g2c_rpc";
var b="__c2g_rpc";
var d;
var c;
function a(g,k,j){try{if(k!==".."){var f=window.frameElement;
if(typeof f[e]==="function"){if(typeof f[e][b]!=="function"){f[e][b]=function(l){d(gadgets.json.parse(l))
}
}f[e](gadgets.json.stringify(j));
return true
}}else{var i=document.getElementById(g);
if(typeof i[e]==="function"&&typeof i[e][b]==="function"){i[e][b](gadgets.json.stringify(j));
return true
}}}catch(h){}return false
}return{getCode:function(){return"fe"
},isParentVerifiable:function(){return false
},init:function(f,g){d=f;
c=g;
return true
},setup:function(j,f){if(j!==".."){try{var i=document.getElementById(j);
i[e]=function(k){d(gadgets.json.parse(k))
}
}catch(h){return false
}}if(j===".."){c("..",true);
var g=function(){window.setTimeout(function(){gadgets.rpc.call(j,gadgets.rpc.ACK)
},500)
};
gadgets.util.registerOnLoadHandler(g)
}return true
},call:function(f,h,g){return a(f,h,g)
}}
}()
};;
gadgets.rpctx=gadgets.rpctx||{};
if(!gadgets.rpctx.nix){gadgets.rpctx.nix=function(){var c="GRPC____NIXVBS_wrapper";
var d="GRPC____NIXVBS_get_wrapper";
var f="GRPC____NIXVBS_handle_message";
var b="GRPC____NIXVBS_create_channel";
var a=10;
var j=500;
var i={};
var h;
var g=0;
function e(){var l=i[".."];
if(l){return
}if(++g>a){gadgets.warn("Nix transport setup failed, falling back...");
h("..",false);
return
}if(!l&&window.opener&&"GetAuthToken" in window.opener){l=window.opener;
if(l.GetAuthToken()==gadgets.rpc.getAuthToken("..")){var k=gadgets.rpc.getAuthToken("..");
l.CreateChannel(window[d]("..",k),k);
i[".."]=l;
window.opener=null;
h("..",true);
return
}}window.setTimeout(function(){e()
},j)
}return{getCode:function(){return"nix"
},isParentVerifiable:function(){return false
},init:function(l,m){h=m;
if(typeof window[d]!=="unknown"){window[f]=function(o){window.setTimeout(function(){l(gadgets.json.parse(o))
},0)
};
window[b]=function(o,q,p){if(gadgets.rpc.getAuthToken(o)===p){i[o]=q;
h(o,true)
}};
var k="Class "+c+"\n Private m_Intended\nPrivate m_Auth\nPublic Sub SetIntendedName(name)\n If isEmpty(m_Intended) Then\nm_Intended = name\nEnd If\nEnd Sub\nPublic Sub SetAuth(auth)\n If isEmpty(m_Auth) Then\nm_Auth = auth\nEnd If\nEnd Sub\nPublic Sub SendMessage(data)\n "+f+"(data)\nEnd Sub\nPublic Function GetAuthToken()\n GetAuthToken = m_Auth\nEnd Function\nPublic Sub CreateChannel(channel, auth)\n Call "+b+"(m_Intended, channel, auth)\nEnd Sub\nEnd Class\nFunction "+d+"(name, auth)\nDim wrap\nSet wrap = New "+c+"\nwrap.SetIntendedName name\nwrap.SetAuth auth\nSet "+d+" = wrap\nEnd Function";
try{window.execScript(k,"vbscript")
}catch(n){return false
}}return true
},setup:function(o,k){if(o===".."){e();
return true
}try{var m=document.getElementById(o);
var n=window[d](o,k);
m.contentWindow.opener=n
}catch(l){return false
}return true
},call:function(k,n,m){try{if(i[k]){i[k].SendMessage(gadgets.json.stringify(m))
}}catch(l){return false
}return true
}}
}()
};;
gadgets.rpctx=gadgets.rpctx||{};
if(!gadgets.rpctx.rmr){gadgets.rpctx.rmr=function(){var h=500;
var f=10;
var i={};
var a=gadgets.util.getUrlParameters()["parent"];
var c;
var j;
function l(q,o,p,n){var r=function(){document.body.appendChild(q);
q.src="about:blank";
if(n){q.onload=function(){m(n)
}
}q.src=o+"#"+p
};
if(document.body){r()
}else{gadgets.util.registerOnLoadHandler(function(){r()
})
}}function d(q){if(typeof i[q]==="object"){return
}var r=document.createElement("iframe");
var o=r.style;
o.position="absolute";
o.top="0px";
o.border="0";
o.opacity="0";
o.width="10px";
o.height="1px";
r.id="rmrtransport-"+q;
r.name=r.id;
var p=gadgets.rpc.getRelayUrl(q);
var n=gadgets.rpc.getOrigin(a);
if(!p){p=n+"/robots.txt"
}i[q]={frame:r,receiveWindow:null,relayUri:p,relayOrigin:n,searchCounter:0,width:10,waiting:true,queue:[],sendId:0,recvId:0,verifySendToken:String(Math.random()),verifyRecvToken:null,originVerified:false};
if(q!==".."){l(r,p,b(q))
}e(q)
}function e(p){var r=null;
i[p].searchCounter++;
try{var o=gadgets.rpc._getTargetWin(p);
if(p===".."){r=o.frames["rmrtransport-"+gadgets.rpc.RPC_ID]
}else{r=o.frames["rmrtransport-.."]
}}catch(q){}var n=false;
if(r){n=g(p,r)
}if(!n){if(i[p].searchCounter>f){return
}window.setTimeout(function(){e(p)
},h)
}}function k(o,q,u,t){var p=null;
if(u!==".."){p=i[".."]
}else{p=i[o]
}if(p){if(q!==gadgets.rpc.ACK){p.queue.push(t)
}if(p.waiting||(p.queue.length===0&&!(q===gadgets.rpc.ACK&&t&&t.ackAlone===true))){return true
}if(p.queue.length>0){p.waiting=true
}var n=p.relayUri+"#"+b(o);
try{p.frame.contentWindow.location=n;
var r=p.width==10?20:10;
p.frame.style.width=r+"px";
p.width=r
}catch(s){return false
}}return true
}function b(o){var p=i[o];
var n={id:p.sendId};
if(p){n.d=Array.prototype.slice.call(p.queue,0);
var q={s:gadgets.rpc.ACK,id:p.recvId};
if(!p.originVerified){q.sendToken=p.verifySendToken
}if(p.verifyRecvToken){q.recvToken=p.verifyRecvToken
}n.d.push(q)
}return gadgets.json.stringify(n)
}function m(y){var v=i[y];
var r=v.receiveWindow.location.hash.substring(1);
var z=gadgets.json.parse(decodeURIComponent(r))||{};
var o=z.d||[];
var p=false;
var u=false;
var w=0;
var n=(v.recvId-z.id);
for(var q=0;
q<o.length;
++q){var t=o[q];
if(t.s===gadgets.rpc.ACK){j(y,true);
v.verifyRecvToken=t.sendToken;
if(!v.originVerified&&t.recvToken&&String(t.recvToken)==String(v.verifySendToken)){v.originVerified=true
}if(v.waiting){u=true
}v.waiting=false;
var s=Math.max(0,t.id-v.sendId);
v.queue.splice(0,s);
v.sendId=Math.max(v.sendId,t.id||0);
continue
}p=true;
if(++w<=n){continue
}++v.recvId;
c(t,v.originVerified?v.relayOrigin:undefined)
}if(p||(u&&v.queue.length>0)){var x=(y==="..")?gadgets.rpc.RPC_ID:"..";
k(y,gadgets.rpc.ACK,x,{ackAlone:p})
}}function g(q,t){var p=i[q];
try{var o=false;
o="document" in t;
if(!o){return false
}o=typeof t.document=="object";
if(!o){return false
}var s=t.location.href;
if(s==="about:blank"){return false
}}catch(n){return false
}p.receiveWindow=t;
function r(){m(q)
}if(typeof t.attachEvent==="undefined"){t.onresize=r
}else{t.attachEvent("onresize",r)
}if(q===".."){l(p.frame,p.relayUri,b(q),q)
}else{m(q)
}return true
}return{getCode:function(){return"rmr"
},isParentVerifiable:function(){return true
},init:function(n,o){c=n;
j=o;
return true
},setup:function(p,n){try{d(p)
}catch(o){gadgets.warn("Caught exception setting up RMR: "+o);
return false
}return true
},call:function(n,p,o){return k(n,o.s,p,o)
}}
}()
};;
gadgets.rpctx=gadgets.rpctx||{};
if(!gadgets.rpctx.ifpc){gadgets.rpctx.ifpc=function(){var h=[];
var e=0;
var d;
var a=2000;
var g={};
function c(m){var k=[];
for(var n=0,l=m.length;
n<l;
++n){k.push(encodeURIComponent(gadgets.json.stringify(m[n])))
}return k.join("&")
}function b(m){var k;
for(var j=h.length-1;
j>=0;
--j){var n=h[j];
try{if(n&&(n.recyclable||n.readyState==="complete")){n.parentNode.removeChild(n);
if(window.ActiveXObject){h[j]=n=null;
h.splice(j,1)
}else{n.recyclable=false;
k=n;
break
}}}catch(l){}}if(!k){k=document.createElement("iframe");
k.style.border=k.style.width=k.style.height="0px";
k.style.visibility="hidden";
k.style.position="absolute";
k.onload=function(){this.recyclable=true
};
h.push(k)
}k.src=m;
window.setTimeout(function(){document.body.appendChild(k)
},0)
}function f(j,l){for(var k=l-1;
k>=0;
--k){if(typeof j[k]==="undefined"){return false
}}return true
}return{getCode:function(){return"ifpc"
},isParentVerifiable:function(){return true
},init:function(i,j){d=j;
d("..",true);
return true
},setup:function(j,i){d(j,true);
return true
},call:function(s,r,q){var l=gadgets.rpc.getRelayUrl(s);
++e;
if(!l){gadgets.warn("No relay file assigned for IFPC");
return false
}var i=null,j=[];
if(q.l){var o=q.a;
i=[l,"#",c([r,e,1,0,c([r,q.s,"","",r].concat(o))])].join("");
j.push(i)
}else{i=[l,"#",s,"&",r,"@",e,"&"].join("");
var t=encodeURIComponent(gadgets.json.stringify(q)),n=a-i.length,p=Math.ceil(t.length/n),m=0,k;
while(t.length>0){k=t.substring(0,n);
t=t.substring(n);
j.push([i,p,"&",m,"&",k].join(""));
m+=1
}}do{b(j.shift())
}while(j.length>0);
return true
},_receiveMessage:function(i,n){var o=i[1],m=parseInt(i[2],10),k=parseInt(i[3],10),l=i[i.length-1],j=m===1;
if(m>1){if(!g[o]){g[o]=[]
}g[o][k]=l;
if(f(g[o],m)){l=g[o].join("");
delete g[o];
j=true
}}if(j){n(gadgets.json.parse(decodeURIComponent(l)))
}}}
}()
};;
if(!window.gadgets["rpc"]){gadgets.rpc=function(){var M="__cb";
var V="";
var W="__ack";
var f=500;
var G=10;
var b="|";
var u="callback";
var g="origin";
var s="referer";
var q={};
var Z={};
var D={};
var B={};
var z=0;
var l={};
var m={};
var T={};
var d={};
var n={};
var E={};
var e=null;
var p=null;
var A=!!gadgets.util.getUrlParameters().parent&&(window.top!==window.self);
var v=window.name;
var J=function(){};
var r=null;
var Q=0;
var ab=1;
var a=2;
var x=window.console;
var Y=x&&x.log?function(ah){x.log(ah)
}:function(){};
var U=(function(){function ah(ai){return function(){Y(ai+": call ignored")
}
}return{getCode:function(){return"noop"
},isParentVerifiable:function(){return true
},init:ah("init"),setup:ah("setup"),call:ah("call")}
})();
if(gadgets.util){d=gadgets.util.getUrlParameters()
}function K(){if(d.rpctx=="flash"){return gadgets.rpctx.flash
}if(d.rpctx=="rmr"){return gadgets.rpctx.rmr
}return typeof window.postMessage==="function"?gadgets.rpctx.wpm:typeof window.postMessage==="object"?gadgets.rpctx.wpm:window.ActiveXObject?(gadgets.rpctx.flash?gadgets.rpctx.flash:gadgets.rpctx.nix):navigator.userAgent.indexOf("WebKit")>0?gadgets.rpctx.rmr:navigator.product==="Gecko"?gadgets.rpctx.frameElement:gadgets.rpctx.ifpc
}function k(am,ak){if(n[am]){return
}var ai=H;
if(!ak){ai=U
}n[am]=ai;
var ah=E[am]||[];
for(var aj=0;
aj<ah.length;
++aj){var al=ah[aj];
al.t=F(am);
ai.call(am,al.f,al)
}E[am]=[]
}var I=false,X=false;
function O(){if(X){return
}function ah(){I=true
}if(typeof window.addEventListener!="undefined"){window.addEventListener("unload",ah,false)
}else{if(typeof window.attachEvent!="undefined"){window.attachEvent("onunload",ah)
}}X=true
}function j(ah,al,ai,ak,aj){if(!B[al]||B[al]!==ai){gadgets.error("Invalid auth token. "+B[al]+" vs "+ai);
J(al,a)
}aj.onunload=function(){if(m[al]&&!I){J(al,ab);
gadgets.rpc.removeReceiver(al)
}};
O();
ak=gadgets.json.parse(decodeURIComponent(ak))
}function ac(al,ai){if(al&&typeof al.s==="string"&&typeof al.f==="string"&&al.a instanceof Array){if(typeof arbitrate==="function"&&!arbitrate(al.s,al.f)){return
}if(B[al.f]){if(B[al.f]!==al.t){gadgets.error("Invalid auth token. "+B[al.f]+" vs "+al.t);
J(al.f,a)
}}if(al.s===W){window.setTimeout(function(){k(al.f,true)
},0);
return
}if(al.c){al[u]=function(am){gadgets.rpc.call(al.f,M,null,al.c,am)
}
}if(ai){var aj=t(ai);
al[g]=ai;
var ak=al.r;
if(!ak||t(ak)!=aj){ak=ai
}al[s]=ak
}var ah=(q[al.s]||q[V]).apply(al,al.a);
if(al.c&&typeof ah!=="undefined"){gadgets.rpc.call(al.f,M,null,al.c,ah)
}}}function t(aj){if(!aj){return""
}aj=aj.toLowerCase();
if(aj.indexOf("//")==0){aj=window.location.protocol+aj
}if(aj.indexOf("://")==-1){aj=window.location.protocol+"//"+aj
}var ak=aj.substring(aj.indexOf("://")+3);
var ah=ak.indexOf("/");
if(ah!=-1){ak=ak.substring(0,ah)
}var am=aj.substring(0,aj.indexOf("://"));
var al="";
var an=ak.indexOf(":");
if(an!=-1){var ai=ak.substring(an+1);
ak=ak.substring(0,an);
if((am==="http"&&ai!=="80")||(am==="https"&&ai!=="443")){al=":"+ai
}}return am+"://"+ak+al
}function C(ai,ah){return"/"+ai+(ah?b+ah:"")
}function y(ak){if(ak.charAt(0)=="/"){var ai=ak.indexOf(b);
var aj=ai>0?ak.substring(1,ai):ak.substring(1);
var ah=ai>0?ak.substring(ai+1):null;
return{id:aj,origin:ah}
}else{return null
}}function ag(aj){if(typeof aj==="undefined"||aj===".."){return window.parent
}var ai=y(aj);
if(ai){return window.frames[ai.id]
}aj=String(aj);
var ah=document.getElementById(aj);
if(ah&&ah.contentWindow){return ah.contentWindow
}ah=window.frames[aj];
if(ah&&!ah.closed){return ah
}return null
}function L(ak){var aj=null;
var ah=P(ak);
if(ah){aj=ah
}else{var ai=y(ak);
if(ai){aj=ai.origin
}else{if(ak==".."){aj=d.parent
}else{aj=document.getElementById(ak).src
}}}return t(aj)
}var H=K();
q[V]=function(){Y("Unknown RPC service: "+this.s)
};
q[M]=function(ai,ah){var aj=l[ai];
if(aj){delete l[ai];
aj.call(this,ah)
}};
function aa(aj,ah){if(m[aj]===true){return
}if(typeof m[aj]==="undefined"){m[aj]=0
}var ai=ag(aj);
if(aj===".."||ai!=null){if(H.setup(aj,ah)===true){m[aj]=true;
return
}}if(m[aj]!==true&&m[aj]++<G){window.setTimeout(function(){aa(aj,ah)
},f)
}else{n[aj]=U;
m[aj]=true
}}var S={};
function N(ai,al){var ak=ag(ai);
if(!T[ai]||(T[ai]!==S&&ak.Function.prototype!==T[ai].constructor.prototype)){var aj=P(ai);
if(t(aj)!==t(window.location.href)){T[ai]=S;
return false
}try{var am=ak.gadgets;
T[ai]=am.rpc.receiveSameDomain
}catch(ah){T[ai]=S;
return false
}}if(T[ai]&&T[ai]!==S){T[ai](al);
return true
}return false
}function P(ai){var ah=Z[ai];
if(ah&&ah.substring(0,1)==="/"){if(ah.substring(1,2)==="/"){ah=document.location.protocol+ah
}else{ah=document.location.protocol+"//"+document.location.host+ah
}}return ah
}function af(ai,ah,aj){if(!/http(s)?:\/\/.+/.test(ah)){if(ah.indexOf("//")==0){ah=window.location.protocol+ah
}else{if(ah.charAt(0)=="/"){ah=window.location.protocol+"//"+window.location.host+ah
}else{if(ah.indexOf("://")==-1){ah=window.location.protocol+"//"+ah
}}}}Z[ai]=ah;
if(typeof aj!=="undefined"){D[ai]=!!aj
}}function F(ah){return B[ah]
}function c(ah,ai){ai=ai||"";
B[ah]=String(ai);
aa(ah,ai)
}function ae(ai){var ah=ai.passReferrer||"";
var aj=ah.split(":",2);
e=aj[0]||"none";
p=aj[1]||"origin"
}function ad(ah){if(R(ah)){H=gadgets.rpctx.ifpc;
H.init(ac,k)
}}function R(ah){return String(ah.useLegacyProtocol)==="true"
}function h(ai,ah){function aj(am){var al=am?am.rpc:{};
ae(al);
var ak=al.parentRelayUrl||"";
ak=t(d.parent||ah)+ak;
af("..",ak,R(al));
ad(al);
c("..",ai)
}if(!d.parent&&ah){aj({});
return
}gadgets.config.register("rpc",null,aj)
}function o(ai,am,ao){var al=null;
if(ai.charAt(0)!="/"){if(!gadgets.util){return
}al=document.getElementById(ai);
if(!al){throw new Error("Cannot set up gadgets.rpc receiver with ID: "+ai+", element not found.")
}}var ah=al&&al.src;
var aj=am||gadgets.rpc.getOrigin(ah);
af(ai,aj);
var an=gadgets.util.getUrlParameters(ah);
var ak=ao||an.rpctoken;
c(ai,ak)
}function i(ah,aj,ak){if(ah===".."){var ai=ak||d.rpctoken||d.ifpctok||"";
h(ai,aj)
}else{o(ah,aj,ak)
}}function w(aj){if(e==="bidir"||(e==="c2p"&&aj==="..")||(e==="p2c"&&aj!=="..")){var ai=window.location.href;
var ak="?";
if(p==="query"){ak="#"
}else{if(p==="hash"){return ai
}}var ah=ai.lastIndexOf(ak);
ah=ah===-1?ai.length:ah;
return ai.substring(0,ah)
}return null
}return{config:function(ah){if(typeof ah.securityCallback==="function"){J=ah.securityCallback
}if(typeof ah.arbitrator==="function"){arbitrate=ah.arbitrator
}},register:function(aj,ai){if(aj===M||aj===W){throw new Error("Cannot overwrite callback/ack service")
}if(aj===V){throw new Error("Cannot overwrite default service: use registerDefault")
}var ah=q[aj];
q[aj]=ai;
return ah
},unregister:function(ah){if(ah===M||ah===W){throw new Error("Cannot delete callback/ack service")
}if(ah===V){throw new Error("Cannot delete default service: use unregisterDefault")
}delete q[ah]
},registerDefault:function(ah){q[V]=ah
},unregisterDefault:function(){delete q[V]
},forceParentVerifiable:function(){if(!H.isParentVerifiable()){H=gadgets.rpctx.ifpc
}},call:function(ah,aj,ao,am){ah=ah||"..";
var an="..";
if(ah===".."){an=v
}else{if(ah.charAt(0)=="/"){an=C(v,gadgets.rpc.getOrigin(window.location.href))
}}++z;
if(ao){l[z]=ao
}var al={s:aj,f:an,c:ao?z:0,a:Array.prototype.slice.call(arguments,3),t:B[ah],l:!!D[ah]};
var ai=w(ah);
if(ai){al.r=ai
}if(ah!==".."&&y(ah)==null&&!document.getElementById(ah)){return
}if(N(ah,al)){return
}var ak=n[ah];
if(!ak&&y(ah)!==null){ak=H
}if(!ak){if(!E[ah]){E[ah]=[al]
}else{E[ah].push(al)
}return
}if(D[ah]){ak=gadgets.rpctx.ifpc
}if(ak.call(ah,an,al)===false){n[ah]=U;
H.call(ah,an,al)
}},getRelayUrl:P,setRelayUrl:af,setAuthToken:c,setupReceiver:i,getAuthToken:F,removeReceiver:function(ah){delete Z[ah];
delete D[ah];
delete B[ah];
delete m[ah];
delete T[ah];
delete n[ah]
},getRelayChannel:function(){return H.getCode()
},receive:function(ai,ah){if(ai.length>4){H._receiveMessage(ai,ac)
}else{j.apply(null,ai.concat(ah))
}},receiveSameDomain:function(ah){ah.a=Array.prototype.slice.call(ah.a);
window.setTimeout(function(){ac(ah)
},0)
},getOrigin:t,getTargetOrigin:L,init:function(){if(H.init(ac,k)===false){H=U
}if(A){i("..")
}else{gadgets.config.register("rpc",null,function(ai){var ah=ai.rpc||{};
ae(ah);
ad(ah)
})
}},_getTargetWin:ag,_parseSiblingId:y,ACK:W,RPC_ID:v||"..",SEC_ERROR_LOAD_TIMEOUT:Q,SEC_ERROR_FRAME_PHISH:ab,SEC_ERROR_FORGED_MSG:a}
}();
gadgets.rpc.init()
};;

/* [end] feature=rpc */

/* [start] feature=shindig.uri */
shindig.uri=(function(){var a=new RegExp("^(?:([^:/?#]+):)?(?://([^/?#]*))?([^?#]*)(?:\\?([^#]*))?(?:#(.*))?");
return function(y){var r="";
var n="";
var c="";
var h="";
var d=null;
var i="";
var j=null;
var l=window.decodeURIComponent?decodeURIComponent:unescape;
var x=window.encodeURIComponent?encodeURIComponent:escape;
var k=null;
function u(A){if(A.match(a)===null){throw"Malformed URL: "+A
}r=RegExp.$1;
n=RegExp.$2;
c=RegExp.$3;
h=RegExp.$4;
i=RegExp.$5
}function t(F){var E=[];
for(var C=0,A=F.length;
C<A;
++C){var B=F[C][0];
var D=F[C][1];
if(typeof D=="undefined"){continue
}E.push(x(B)+(D!==null?"="+x(D):""))
}return E.join("&")
}function q(){if(d){h=t(d);
d=null
}return h
}function z(){if(j){i=t(j);
j=null
}return i
}function o(A){d=d||f(h);
return s(d,A)
}function w(A){j=j||f(i);
return s(j,A)
}function b(B,A){d=m(d||f(h),B,A);
return k
}function g(B,A){j=m(j||f(i),B,A);
return k
}function v(){return[r,r!==""?":":"",n!==""?"//":"",n].join("")
}function p(){var B=q();
var A=z();
return[v(),c,B!==""?"?":"",B,A!==""?"#":"",A].join("")
}function f(H){var G=[];
if(H===""){return G
}var F=H.split("&");
for(var C=0,A=F.length;
C<A;
++C){var E=F[C].split("=");
var B=E.shift();
var D=null;
if(E.length>0){D=E.join("").replace(/\+/g," ")
}G.push([B,D!=null?l(D):null])
}return G
}function s(A,D){for(var C=0,B=A.length;
C<B;
++C){if(A[C][0]==D){return A[C][1]
}}return undefined
}function m(E,F,D){var H=F;
if(typeof F==="string"){H={};
H[F]=D
}for(var C in H){var G=false;
for(var B=0,A=E.length;
!G&&B<A;
++B){if(E[B][0]==C){E[B][1]=H[C];
G=true
}}if(!G){E.push([C,H[C]])
}}return E
}function e(B,A){B=B||"";
if(B[0]===A){B=B.substr(A.length)
}return B
}if(typeof y==="object"&&typeof y.toString==="function"){u(y.toString())
}else{if(y){u(y)
}}k={getSchema:function(){return r
},getAuthority:function(){return n
},getOrigin:v,getPath:function(){return c
},getQuery:q,getFragment:z,getQP:o,getFP:w,setSchema:function(A){r=A;
return k
},setAuthority:function(A){n=A;
return k
},setPath:function(A){if(typeof A!=="undefined"&&A!=null){c=(A[0]==="/"?"":"/")+A
}return k
},setQuery:function(A){d=null;
h=e(A,"?");
return k
},setFragment:function(A){j=null;
i=e(A,"#");
return k
},setQP:b,setFP:g,setExistingP:function(A,B){if(typeof(o(A,B))!="undefined"){b(A,B)
}if(typeof(w(A,B))!="undefined"){g(A,B)
}return k
},toString:p};
return k
}
})();;

/* [end] feature=shindig.uri */

/* [start] feature=core.io */
gadgets.io=function(){function makeXhr(){var e;if("undefined"!=typeof shindig&&shindig.xhrwrapper&&shindig.xhrwrapper.createXHR)return shindig.xhrwrapper.createXHR();if("undefined"!=typeof ActiveXObject)try{return e=new ActiveXObject("Msxml2.XMLHTTP"),e||(e=new ActiveXObject("Microsoft.XMLHTTP")),e}catch(t){}if("undefined"!=typeof XMLHttpRequest||window.XMLHttpRequest)return new window.XMLHttpRequest;throw"no xhr available"}function hadError(e,t){if(4!==e.readyState)return!0;try{if(200!==e.status){var r=""+e.status;return e.responseText&&(r=r+" "+e.responseText),t({errors:[r],rc:e.status,text:e.responseText}),!0}}catch(a){return t({errors:[a.number+" Error not specified"],rc:a.number,text:a.description}),!0}return!1}function processNonProxiedResponse(e,t,r,a){if(!hadError(a,t)){var o={body:a.responseText};t(transformResponseData(r,o))}}function processResponse(url,callback,params,xobj){if(!hadError(xobj,callback)){var txt=xobj.responseText,UNPARSEABLE_CRUFT=config.unparseableCruft,offset=txt.indexOf(UNPARSEABLE_CRUFT)+UNPARSEABLE_CRUFT.length;if(!(offset<UNPARSEABLE_CRUFT.length)){txt=txt.substr(offset);var data=eval("("+txt+")");data=data[url],data.oauthState&&(oauthState=data.oauthState),data.st&&shindig.auth.updateSecurityToken(data.st),callback(transformResponseData(params,data))}}}function transformResponseData(e,t){var r={text:t.body,rc:t.rc||200,headers:t.headers,oauthApprovalUrl:t.oauthApprovalUrl,oauthError:t.oauthError,oauthErrorText:t.oauthErrorText,oauthErrorTrace:t.oauthErrorTrace,oauthErrorUri:t.oauthErrorUri,oauthErrorExplanation:t.oauthErrorExplanation,errors:[]};if(r.rc<200||r.rc>=400)r.errors=[r.rc+" Error"];else if(r.text)switch(r.rc>=300&&r.rc<400&&(e.CONTENT_TYPE="TEXT"),e.CONTENT_TYPE){case"JSON":case"FEED":r.data=gadgets.json.parse(r.text),r.data||(r.errors.push("500 Failed to parse JSON"),r.rc=500,r.data=null);break;case"DOM":var a;if("undefined"!=typeof DOMParser){var o=new DOMParser;a=o.parseFromString(r.text,"text/xml"),"parsererror"===a.documentElement.nodeName?(r.errors.push("500 Failed to parse XML"),r.rc=500):r.data=a}else"undefined"!=typeof ActiveXObject?(a=new ActiveXObject("Microsoft.XMLDOM"),a.async=!1,a.validateOnParse=!1,a.resolveExternals=!1,a.loadXML(r.text)?r.data=a:(r.errors.push("500 Failed to parse XML"),r.rc=500)):(r.errors.push("500 Failed to parse XML because no DOM parser was available"),r.rc=500);break;default:r.data=r.text}return r}function makeXhrRequest(e,t,r,a,o,n,s,i){var d=makeXhr();if(0==t.indexOf("//")&&(t=document.location.protocol+t),d.open(o,t,!0),r){var u=gadgets.util.makeClosure(null,s,e,r,n,d),c=gadgets.util.shouldPollXhrReadyStateChange();c?handleReadyState(d,u):d.onreadystatechange=u}"string"==typeof i&&(p=i,i={});var l=i||{};if(null!==a){var E="Content-Type",p="application/x-www-form-urlencoded";l[E]||(l[E]=p)}for(var h in l)d.setRequestHeader(h,l[h]);d.send(a)}function handleReadyState(e,t){var r=ioTransactionId,a=config.xhrPollIntervalMs||50;ajaxPollQ[r]=window.setInterval(function(){e&&4===e.readyState&&(window.clearInterval(ajaxPollQ[r]),delete ajaxPollQ[r],t&&t())},a),ioTransactionId++}function respondWithPreload(e,t,r){if(gadgets.io.preloaded_&&"GET"===e.httpMethod)for(var a=0;a<gadgets.io.preloaded_.length;a++){var o=gadgets.io.preloaded_[a];if(o&&o.id===e.url){if(delete gadgets.io.preloaded_[a],200!==o.rc)r({rc:o.rc,errors:[o.rc+" Error"]});else{o.oauthState&&(oauthState=o.oauthState);var n={body:o.body,rc:o.rc,headers:o.headers,oauthApprovalUrl:o.oauthApprovalUrl,oauthError:o.oauthError,oauthErrorText:o.oauthErrorText,oauthErrorTrace:o.oauthErrorTrace,oauthErrorUri:o.oauthErrorUri,oauthErrorExplanation:o.oauthErrorExplanation,errors:[]};r(transformResponseData(t,n))}return!0}}return!1}function init(e){config=e["core.io"]||{}}var ioTransactionId=0,ajaxPollQ={},config={},oauthState;return gadgets.config.register("core.io",null,init),{makeRequest:function(e,t,r){var a,o,n=r||{},s=n.METHOD||"GET",i=n.REFRESH_INTERVAL;n.AUTHORIZATION&&"NONE"!==n.AUTHORIZATION&&(a=n.AUTHORIZATION.toLowerCase(),o=shindig.auth.getSecurityToken());var d=!0;"undefined"!=typeof n.SIGN_OWNER&&(d=n.SIGN_OWNER);var u=!0;"undefined"!=typeof n.SIGN_VIEWER&&(u=n.SIGN_VIEWER);var c=n.HEADERS||{};"POST"!==s||c["Content-Type"]||(c["Content-Type"]="application/x-www-form-urlencoded");var l=gadgets.util.getUrlParameters(),E={url:e,httpMethod:s,headers:gadgets.io.encodeValues(c,!1),postData:n.POST_DATA||"",authz:a||"",st:o||"",contentType:n.CONTENT_TYPE||"TEXT",numEntries:n.NUM_ENTRIES||"3",getSummaries:!!n.GET_SUMMARIES,signOwner:d,signViewer:u,gadget:l.url,container:l.container||l.synd||"default",bypassSpecCache:gadgets.util.getUrlParameters().nocache||"",getFullHeaders:!!n.GET_FULL_HEADERS};if("oauth"===a||"signed"===a||"oauth2"===a){gadgets.io.oauthReceivedCallbackUrl_&&(E.OAUTH_RECEIVED_CALLBACK=gadgets.io.oauthReceivedCallbackUrl_,gadgets.io.oauthReceivedCallbackUrl_=null),E.oauthState=oauthState||"";for(var p in n)n.hasOwnProperty(p)&&(0===p.indexOf("OAUTH_")||"code"===p)&&(E[p]=n[p])}o=o||shindig.auth.getSecurityToken();var h=o?{"X-Shindig-ST":o}:{},T=config.jsonProxyUrl.replace("%host%",document.location.host);if(!respondWithPreload(E,n,t))if("GET"==s&&"undefined"!=typeof i&&(E.refresh=i),"GET"!==s||E.authz){var g=gadgets.io.encodeValues(E);makeXhrRequest(e,T,t,g,"POST",n,processResponse,h)}else{var g="?"+gadgets.io.encodeValues(E);makeXhrRequest(e,T+g,t,null,"GET",n,processResponse,h)}},makeNonProxiedRequest:function(e,t,r,a){var o=r||{};makeXhrRequest(e,e,t,o.POST_DATA,o.METHOD,o,processNonProxiedResponse,a)},clearOAuthState:function(){oauthState=void 0},encodeValues:function(e,t){var r=!t,a=[],o=!1;for(var n in e)e.hasOwnProperty(n)&&!/___$/.test(n)&&(o?a.push("&"):o=!0,a.push(r?encodeURIComponent(n):n),a.push("="),a.push(r?encodeURIComponent(e[n]):e[n]));return a.join("")},getProxyUrl:function(e,t){var r=config.proxyUrl;if(!r)return r;var a=t||{},o=a.REFRESH_INTERVAL;"undefined"==typeof o&&(o="3600");var n=gadgets.util.getUrlParameters(),s=shindig.auth.getSecurityToken(),i=a[gadgets.io.RequestParameters.AUTHORIZATION],d=a[gadgets.io.RequestParameters.OAUTH_SERVICE_NAME],u=a.rewriteMime?"&rewriteMime="+encodeURIComponent(a.rewriteMime):"",c="";c=i?i==gadgets.io.AuthorizationType.OAUTH||i==gadgets.io.AuthorizationType.OAUTH2?"&authz="+i.toLowerCase()+"&st="+encodeURIComponent(s)+"&OAUTH_SERVICE_NAME="+encodeURIComponent(d):"&authz="+i.toLowerCase()+"&st="+encodeURIComponent(s):"&st="+encodeURIComponent(s);var l=a.host||document.location.host,E=r.replace("%url%",encodeURIComponent(e)).replace("%host%",l).replace("%rawurl%",e).replace("%refresh%",encodeURIComponent(o)).replace("%gadget%",encodeURIComponent(n.url)).replace("%container%",encodeURIComponent(n.container||n.synd||"default")).replace("%authz%",c).replace("%rewriteMime%",u);return 0==E.indexOf("//")&&(E=window.location.protocol+E),E},processResponse_:processResponse}}(),gadgets.io.RequestParameters=gadgets.util.makeEnum(["METHOD","CONTENT_TYPE","POST_DATA","HEADERS","AUTHORIZATION","NUM_ENTRIES","GET_SUMMARIES","GET_FULL_HEADERS","REFRESH_INTERVAL","SIGN_OWNER","SIGN_VIEWER","OAUTH_SERVICE_NAME","OAUTH_USE_TOKEN","OAUTH_TOKEN_NAME","OAUTH_REQUEST_TOKEN","OAUTH_REQUEST_TOKEN_SECRET","OAUTH_RECEIVED_CALLBACK"]),gadgets.io.MethodType=gadgets.util.makeEnum(["GET","POST","PUT","DELETE","HEAD"]),gadgets.io.ContentType=gadgets.util.makeEnum(["TEXT","DOM","JSON","FEED"]),gadgets.io.AuthorizationType=gadgets.util.makeEnum(["NONE","SIGNED","OAUTH","OAUTH2"]);;

/* [end] feature=core.io */

/* [start] feature=osapi.base */
(function(){var a=function(){var c={};
var b=[];
var f=function(g,h){if(h&&g){b.push({key:g,request:h})
}return c
};
var e=function(h){var g={method:h.request["method"],id:h.key};
if(h.request["rpc"]){g.params=h.request["rpc"]
}return g
};
var d=function(g){var h={};
var q={};
var l=0;
var m=[];
for(var o=0;
o<b.length;
o++){var k=b[o]["request"]["transport"];
if(!q[k.name]){m.push(k);
l++
}q[k.name]=q[k.name]||[];
q[k.name].push(e(b[o]))
}var p=function(t){if(t.error){h.error=t.error
}for(var s=0;
s<b.length;
s++){var r=b[s]["key"];
var j=t[r];
if(j){if(j.error){h[r]=j
}else{h[r]=j.data||j.result
}}}l--;
if(l===0){g(h)
}};
for(var n=0;
n<m.length;
n++){m[n].execute(q[m[n]["name"]],p)
}if(l==0){window.setTimeout(function(){g(h)
},0)
}};
c.execute=d;
c.add=f;
return c
};
osapi.newBatch=a
})();;
osapi._registerMethod=function(h,g){if(h==="newBatch"){return
}var f=h.split(".");
var d=osapi;
for(var c=0;
c<f.length-1;
c++){d[f[c]]=d[f[c]]||{};
d=d[f[c]]
}var e=f[f.length-1],a;
if(d[e]){a=d[e]
}d[e]=function(j){j=j||{};
j.userId=j.userId||"@viewer";
j.groupId=j.groupId||"@self";
var i=new osapi._BoundCall(h,g,j);
return i
};
if(typeof tamings___!=="undefined"){var b=function(){caja___.markFunction(d[e],h)
};
if(a&&a.__taming_index){d[e].__taming_index=a.__taming_index;
tamings___[a.__taming_index]=b
}else{d[e].__taming_index=tamings___.length;
tamings___.push(b)
}}};
osapi._BoundCall=function(c,b,a){this["method"]=c;
this["transport"]=b;
this["rpc"]=a
};
osapi._BoundCall.prototype.execute=function(e){var a=(typeof caja___!=="undefined"&&caja___.getUseless&&caja___.getUseless());
var d=a?caja___.getUseless():this;
var b=a?caja___.untame(e):e;
var c=osapi.newBatch();
c.add(this.method,this);
c.execute(function(f){if(f.error){b.call(d,{error:f.error})
}else{b.call(d,f[d.method])
}})
};;

/* [end] feature=osapi.base */

/* [start] feature=shindig.uri.ext */
shindig._uri=shindig.uri;
shindig.uri=(function(){var c=shindig._uri;
shindig._uri=null;
function a(e,d){return e.getOrigin()==d.getOrigin()
}function b(e,g){if(e.getSchema()==""){e.setSchema(g.getSchema())
}if(e.getAuthority()==""){e.setAuthority(g.getAuthority())
}var f=e.getPath();
if(f==""||f.charAt(0)!="/"){var h=g.getPath();
var d=h.lastIndexOf("/");
if(d!=-1){h=h.substring(0,d+1)
}e.setPath(g.getPath()+f)
}}return function(d){var e=c(d);
e.hasSameOrigin=function(f){return a(e,f)
};
e.resolve=function(f){return b(e,f)
};
return e
}
})();;

/* [end] feature=shindig.uri.ext */

/* [start] feature=osapi */
(function(){var a;
function b(j,i){function g(l){if(l.errors[0]){i({error:{code:l.rc,message:l.text}})
}else{var m=l.result||l.data;
if(m.error){i(m)
}else{var k={};
for(var n=0;
n<m.length;
n++){k[m[n]["id"]]=m[n]
}i(k)
}}}var f={POST_DATA:gadgets.json.stringify(j),CONTENT_TYPE:"JSON",METHOD:"POST",AUTHORIZATION:"SIGNED"};
var h={"Content-Type":"application/json"};
var d=this.name;
var e=shindig.auth.getSecurityToken();
if(e){if(a){h.Authorization="OAuth2 "+e
}else{d+="?st=";
d+=encodeURIComponent(e)
}}gadgets.io.makeNonProxiedRequest(d,g,f,h)
}function c(g){var j=g["osapi.services"];
a=g["osapi.useOAuth2"];
if(j){for(var f in j){if(j.hasOwnProperty(f)){if(f.indexOf("http")==0||f.indexOf("//")==0){var d=f.replace("%host%",document.location.host);
var k={name:d,execute:b};
var e=j[f];
for(var h=0;
h<e.length;
h++){osapi._registerMethod(e[h],k)
}}}}}}if(gadgets.config){gadgets.config.register("osapi.services",null,c)
}})();;
gadgets.util.registerOnLoadHandler(function(){if(osapi&&osapi.people&&osapi.people.get){osapi.people.getViewer=function(a){a=a||{};
a.userId="@viewer";
a.groupId="@self";
return osapi.people.get(a)
};
osapi.people.getViewerFriends=function(a){a=a||{};
a.userId="@viewer";
a.groupId="@friends";
return osapi.people.get(a)
};
osapi.people.getOwner=function(a){a=a||{};
a.userId="@owner";
a.groupId="@self";
return osapi.people.get(a)
};
osapi.people.getOwnerFriends=function(a){a=a||{};
a.userId="@owner";
a.groupId="@friends";
return osapi.people.get(a)
}
}});;

/* [end] feature=osapi */

/* [start] feature=container.util */
osapi.container={};
osapi.container.MetadataParam={LOCAL_EXPIRE_TIME:"localExpireTimeMs",URL:"url"};
osapi.container.MetadataResponse={IFRAME_URLS:"iframeUrls",NEEDS_TOKEN_REFRESH:"needsTokenRefresh",VIEWS:"views",EXPIRE_TIME_MS:"expireTimeMs",FEATURES:"features",HEIGHT:"height",MODULE_PREFS:"modulePrefs",PREFERRED_HEIGHT:"preferredHeight",PREFERRED_WIDTH:"preferredWidth",RESPONSE_TIME_MS:"responseTimeMs",WIDTH:"width",TOKEN_TTL:"tokenTTL"};
osapi.container.TokenResponse={TOKEN:"token",TOKEN_TTL:"tokenTTL",MODULE_ID:"moduleId"};
osapi.container.NavigateTiming={URL:"url",ID:"id",START:"start",XRT:"xrt",SRT:"srt",DL:"dl",OL:"ol",PRT:"prt"};
osapi.container.RenderParam={ALLOW_DEFAULT_VIEW:"allowDefaultView",CAJOLE:"cajole",CLASS:"class",DEBUG:"debug",HEIGHT:"height",NO_CACHE:"nocache",TEST_MODE:"testmode",USER_PREFS:"userPrefs",VIEW:"view",WIDTH:"width",MODULE_ID:"moduleid"};
osapi.container.ViewParam={VIEW:"view"};
osapi.container.CallbackType={ON_BEFORE_PRELOAD:"onBeforePreload",ON_PRELOADED:"onPreloaded",ON_BEFORE_NAVIGATE:"onBeforeNavigate",ON_NAVIGATED:"onNavigated",ON_BEFORE_CLOSE:"onBeforeClose",ON_CLOSED:"onClosed",ON_BEFORE_UNLOAD:"onBeforeUnload",ON_UNLOADED:"onUnloaded",ON_BEFORE_RENDER:"onBeforeRender",ON_RENDER:"onRender",GADGET_ON_LOAD:"__gadgetOnLoad"};
osapi.container.ContainerConfig={ALLOW_DEFAULT_VIEW:"allowDefaultView",RENDER_CAJOLE:"renderCajole",RENDER_DEBUG:"renderDebug",RENDER_DEBUG_PARAM:"renderDebugParam",RENDER_TEST:"renderTest",TOKEN_REFRESH_INTERVAL:"tokenRefreshInterval",NAVIGATE_CALLBACK:"navigateCallback",PRELOAD_REF_TIME:"preloadRefTime",PRELOAD_METADATAS:"preloadMetadatas",PRELOAD_TOKENS:"preloadTokens",GET_LANGUAGE:"GET_LANGUAGE",GET_COUNTRY:"GET_COUNTRY",GET_PREFERENCES:"GET_PREFERENCES",SET_PREFERENCES:"SET_PREFERENCES",RPC_ARBITRATOR:"rpcArbitrator",GET_GADGET_TOKEN:"GET_GADGET_TOKEN",GET_CONTAINER_TOKEN:"GET_CONTAINER_TOKEN"};
osapi.container.ServiceConfig={API_HOST:"apiHost",API_PATH:"apiPath"};
;
osapi.container.util={},osapi.container.util.getSafeJsonValue=function(e,n,i){return"undefined"!=typeof e[n]&&null!=e[n]?e[n]:i},osapi.container.util.mergeJsons=function(e,n){var i={};for(var r in e)i[r]=e[r];for(var r in n)i[r]=n[r];return i},osapi.container.util.newMetadataRequest=function(e){return osapi.container.util.isArray(e)||(e=[e]),{container:window.__CONTAINER,ids:e,fields:["iframeUrls","modulePrefs.*","needsTokenRefresh","userPrefs.*","views.preferredHeight","views.preferredWidth","expireTimeMs","responseTimeMs","rpcServiceIds","tokenTTL"]}},osapi.container.util.newTokenRequest=function(e){return osapi.container.util.isArray(e)||(e=[e]),{container:window.__CONTAINER,ids:e,fields:["token","tokenTTL","moduleId"]}},osapi.container.util.toArrayOfJsonKeys=function(e){var n=[];for(var i in e)n.push(i);return n},osapi.container.util.isArray=function(e){return"[object Array]"==Object.prototype.toString.call(e)},osapi.container.util.isEmptyJson=function(e){for(var n in e)return!1;return!0},osapi.container.util.getCurrentTimeMs=function(){return(new Date).getTime()},osapi.container.util.createIframeHtml=function(e){var n=[],i=0;n[i++]="<iframe ";for(var r in e)if("src"!==r){var t=e[r];"undefined"!=typeof t&&(n[i++]=r,n[i++]='="',n[i++]=t,n[i++]='" ')}n[i++]="></iframe>";var o=e.src.split(/[?#]/g),a=o[1].split("&"),s=o[0]+"#"+o[2];o[2].split("&").forEach(function(e){-1!=e.indexOf("view-params")&&a.push(e)}),n[i++]="<form ",n[i++]='method="post" action="',n[i++]=s,n[i++]='" target="',n[i++]=e.name,n[i++]='" id="form_',n[i++]=e.id,n[i++]='"',n[i++]=">";for(var u=0;u<a.length;u++){var f=a[u].split("=",2);n[i++]='<input type="hidden" name="',n[i++]=f[0],n[i++]="\" value='",n[i++]=decodeURIComponent(f[1]),n[i++]="'/>"}return n[i++]='<input type="hidden" name="_jive_userID" value="',n[i++]=window._jive_effective_user_id,n[i++]='"/>',n[i++]="</form>",window.setTimeout(function(){document.getElementById("form_"+e.id).submit()},1),n.join("")},osapi.container.util.buildTokenRequestUrl=function(e,n){return e=shindig.uri(e),n&&e.setFragment(n),e.toString()};
;

/* [end] feature=container.util */

/* [start] feature=container.site */
osapi.container.Site=function(b,a,d,c){var e;
this.container_=b;
this.service_=a;
this.el_=d;
this.id_=(this.el_&&this.el_.id)?this.el_.id:osapi.container.Site.prototype.nextUniqueSiteId_++;
this.parentId_=e;
this.ownerId_=e
};
osapi.container.Site.prototype.nextUniqueSiteId_=0;
osapi.container.Site.prototype.onConstructed=function(){};
osapi.container.Site.prototype.getId=function(){return this.id_
};
osapi.container.Site.prototype.setWidth=function(c){var a=this.getActiveSiteHolder();
if(a){var b=a.getIframeElement();
if(b){b.style.width=c+"px"
}}return this
};
osapi.container.Site.prototype.setHeight=function(c){var a=this.getActiveSiteHolder();
if(a){var b=a.getIframeElement();
if(b){b.style.height=c+"px"
}}return this
};
osapi.container.Site.prototype.close=function(){var a=this.getActiveSiteHolder();
a&&a.dispose()
};
osapi.container.Site.prototype.getParentId=function(){return this.parentId_
};
osapi.container.Site.prototype.setParentId=function(a){this.parentId_=a;
return this
};
osapi.container.Site.prototype.getActiveSiteHolder=function(){throw new Error("This method must be implemented by a subclass.")
};
osapi.container.Site.prototype.render=function(){throw new Error("This method must be implemented by a subclass.")
};;
osapi.container.SiteHolder=function(a,d,c){var b;
this.site_=a;
this.el_=d;
this.onLoad_=c;
this.iframeId_=b;
this.renderParams_=b;
this.onConstructed()
};
osapi.container.SiteHolder.prototype.onConstructed=function(){};
osapi.container.SiteHolder.prototype.getElement=function(){return this.el_
};
osapi.container.SiteHolder.prototype.getIframeId=function(){return this.iframeId_
};
osapi.container.SiteHolder.prototype.dispose=function(){if(this.el_&&this.el_.firstChild){this.el_.removeChild(this.el_.firstChild)
}};
osapi.container.SiteHolder.prototype.createIframeHtml=function(a,b){return osapi.container.util.createIframeHtml(this.createIframeAttributeMap(a,b))
};
osapi.container.SiteHolder.prototype.createIframeAttributeMap=function(a,f){var c,d=this.renderParams_||{},e={id:this.iframeId_,name:this.iframeId_,src:a,scrolling:"no",marginwidth:0,marginheight:0,frameborder:0,vspace:0,hspace:0,"class":d[osapi.container.RenderParam.CLASS],height:d[osapi.container.RenderParam.HEIGHT],width:d[osapi.container.RenderParam.WIDTH],onload:this.onLoad_?("window."+this.onLoad_+"('"+this.getUrl()+"', '"+this.site_.getId()+"');"):c};
if(f){for(var b in f){e[b]=f[b]
}}return e
};
osapi.container.SiteHolder.prototype.getIframeElement=function(){throw new Error("This method must be implemented by a subclass.")
};
osapi.container.SiteHolder.prototype.render=function(){throw new Error("This method must be implemented by a subclass.")
};
osapi.container.SiteHolder.prototype.getUrl=function(){throw new Error("This method must be implemented by a subclass.")
};;

/* [end] feature=container.site */

/* [start] feature=container.site.gadget */
osapi.container.GadgetHolder=function(a,d,c){osapi.container.SiteHolder.call(this,a,d,c);
var b;
this.gadgetInfo_=b;
this.viewParams_=b;
this.securityToken_=b;
this.onConstructed()
};
osapi.container.GadgetHolder.prototype=new osapi.container.SiteHolder;
osapi.container.GadgetHolder.prototype.relayPath_=null;
osapi.container.GadgetHolder.prototype.getGadgetInfo=function(){return this.gadgetInfo_
};
osapi.container.GadgetHolder.prototype.dispose=function(){osapi.container.SiteHolder.prototype.dispose.call(this);
this.gadgetInfo_=null
};
osapi.container.GadgetHolder.prototype.getUrl=function(){return this.gadgetInfo_&&this.gadgetInfo_.url
};
osapi.container.GadgetHolder.prototype.getView=function(){return this.renderParams_[osapi.container.RenderParam.VIEW]
};
osapi.container.GadgetHolder.prototype.getIframeElement=function(){return this.el_.getElementsByTagName("iframe")[0]
};
osapi.container.GadgetHolder.prototype.setSecurityToken=function(a){this.securityToken_=a;
return this
};
osapi.container.GadgetHolder.prototype.render=function(b,a,c){this.iframeId_=osapi.container.GadgetHolder.IFRAME_ID_PREFIX_+this.site_.getId();
this.gadgetInfo_=b;
this.viewParams_=a;
this.renderParams_=c;
if(this.hasFeature_(b,"pubsub-2")){this.doOaaIframeHtml_()
}else{this.doNormalIframeHtml_()
}};
osapi.container.GadgetHolder.IFRAME_ID_PREFIX_="__gadget_";
osapi.container.GadgetHolder.prototype.doNormalIframeHtml_=function(){var b=this.getIframeUrl_();
this.el_.innerHTML=this.createIframeHtml(b);
var c=shindig.uri(b);
var a=shindig.uri().setSchema(c.getSchema()).setAuthority(c.getAuthority()).setPath(this.relayPath_);
gadgets.rpc.setupReceiver(this.iframeId_,a.toString(),c.getFP("rpctoken"))
};
osapi.container.GadgetHolder.prototype.doOaaIframeHtml_=function(){this.removeOaaContainer_(this.iframeId_);
new OpenAjax.hub.IframeContainer(gadgets.pubsub2router.hub,this.iframeId_,{Container:{onSecurityAlert:function(b,a){gadgets.error(["Security error for container ",b.getClientID()," : ",a].join(""));
b.getIframe().src="about:blank"
},onConnect:function(a){gadgets.log(["connected: ",a.getClientID()].join(""))
}},IframeContainer:{parent:this.el_,uri:this.getIframeUrl_(),tunnelURI:shindig.uri(this.relayPath_).resolve(shindig.uri(window.location.href)),iframeAttrs:this.createIframeAttributeMap(this.getIframeUrl_()),onGadgetLoad:this.onLoad_}})
};
osapi.container.GadgetHolder.prototype.removeOaaContainer_=function(b){var a=gadgets.pubsub2router.hub.getContainer(b);
if(a){gadgets.pubsub2router.hub.removeContainer(a)
}};
osapi.container.GadgetHolder.prototype.hasFeature_=function(c,a){var d=c[osapi.container.MetadataResponse.MODULE_PREFS];
if(d){var b=d[osapi.container.MetadataResponse.FEATURES];
if(b&&b[a]){return true
}}return false
};
osapi.container.GadgetHolder.prototype.getIframeUrl_=function(){var d=shindig.uri(this.gadgetInfo_[osapi.container.MetadataResponse.IFRAME_URLS][this.getView()]);
d.setQP("debug",this.renderParams_[osapi.container.RenderParam.DEBUG]?"1":"0");
d.setQP("nocache",this.renderParams_[osapi.container.RenderParam.NO_CACHE]?"1":"0");
d.setQP("testmode",this.renderParams_[osapi.container.RenderParam.TEST_MODE]?"1":"0");
d.setQP("view",this.getView());
if(this.renderParams_[osapi.container.RenderParam.CAJOLE]){var f=d.getQP("libs");
if(f==null||f==""){d.setQP("libs","caja")
}else{d.setQP("libs",[f,":caja"].join(""))
}d.setQP("caja","1")
}this.updateUserPrefParams_(d);
d.setQP("parent",window.__CONTAINER_URI.getOrigin());
if(this.securityToken_){d.setExistingP("st",this.securityToken_)
}d.setQP("mid",String(this.site_.getModuleId()));
if(!osapi.container.util.isEmptyJson(this.viewParams_)){var c=gadgets.json.stringify(this.viewParams_);
d.setFP("view-params",c)
}if(typeof(d.getFP("rpctoken"))==="undefined"){var a=(2147483647*Math.random())|0;
d.setFP("rpctoken",a)
}var h=this.site_.service_.getLanguage();
var g=this.site_.service_.getCountry();
var e=d.getQP("lang"),b=d.getQP("country");
if(e.indexOf("%")!=-1){d.setQP("lang",h)
}if(b.indexOf("%")!=-1){d.setQP("country",g)
}return d.toString()
};
osapi.container.GadgetHolder.prototype.updateUserPrefParams_=function(e){var d=this.renderParams_[osapi.container.RenderParam.USER_PREFS];
if(d){for(var a in d){var c="up_"+a;
var b=d[a];
if(b instanceof Array){b=b.join("|")
}e.setExistingP(c,b)
}}};
function init(a){if(a.container){var b=a.container["relayPath"];
osapi.container.GadgetHolder.prototype.relayPath_=b
}}if(gadgets.config){gadgets.config.register("container",null,init)
};;
osapi.container.GadgetSite=function(b,a,c){var d;
osapi.container.Site.call(this,b,a,c.gadgetEl);
this.navigateCallback_=c.navigateCallback;
this.loadingGadgetEl_=c.bufferEl;
this.gadgetOnLoad_=c.gadgetOnLoad;
this.moduleId_=0;
this.currentGadgetHolder_=d;
this.loadingGadgetHolder_=d;
this.onConstructed()
};
osapi.container.GadgetSite.prototype=new osapi.container.Site;
osapi.container.GadgetSite.prototype.getModuleId=function(){return this.moduleId_
};
osapi.container.GadgetSite.prototype.setModuleId_=function(d,c,b){if(c&&this.moduleId_!=c){var a=this,d=osapi.container.util.buildTokenRequestUrl(d,c);
if(!a.service_.getCachedGadgetToken(d)){var e=osapi.container.util.newTokenRequest([d]);
a.service_.getGadgetToken(e,function(g){var f,h;
if(g&&g[d]){if(f=g[d][osapi.container.TokenResponse.TOKEN_TTL]){a.container_.scheduleRefreshTokens_(f)
}var h=g[d][osapi.container.TokenResponse.MODULE_ID];
if(h||h==0){a.moduleId_=h
}}if(b){b()
}});
return
}}if(b){b()
}};
osapi.container.GadgetSite.prototype.getActiveSiteHolder=function(){return this.loadingGadgetHolder_||this.currentGadgetHolder_
};
osapi.container.GadgetSite.prototype.getFeature=function(a,b){var c=b||this.getActiveSiteHolder().getGadgetInfo();
return c[osapi.container.MetadataResponse.FEATURES]&&c[osapi.container.MetadataResponse.FEATURES][a]
};
osapi.container.GadgetSite.prototype.navigateTo=function(i,h,b,e){var a=osapi.container.util.getCurrentTimeMs();
var c=this.service_.getCachedGadgetMetadata(i);
var f=e||function(){};
var d=osapi.container.util.newMetadataRequest([i]);
var g=this;
this.service_.getGadgetMetadata(d,function(k){var m=(!c)?(osapi.container.util.getCurrentTimeMs()-a):0;
var l=k[i];
if(l.error){var o=["Failed to navigate for gadget ",i,"."].join("");
gadgets.warn(o);
o=["Detailed error: ",l.error.code||""," ",l.error.message||""].join("");
gadgets.log(o)
}else{var n=b[osapi.container.RenderParam.MODULE_ID]||0;
g.setModuleId_(i,n,function(){g.container_.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_BEFORE_RENDER,l);
g.render(l,h,b)
})
}var j={};
j[osapi.container.NavigateTiming.URL]=i;
j[osapi.container.NavigateTiming.ID]=g.id_;
j[osapi.container.NavigateTiming.START]=a;
j[osapi.container.NavigateTiming.XRT]=m;
g.onNavigateTo(j);
f(l)
})
};
osapi.container.GadgetSite.prototype.onNavigateTo=function(b){if(this.navigateCallback_){var a=window[this.navigateCallback_];
if(typeof a==="function"){a(b)
}}};
osapi.container.GadgetSite.prototype.render=function(i,l,b){var f=this.currentGadgetHolder_?this.currentGadgetHolder_.getUrl():null;
var c=null;
if(f==i.url){c=this.currentGadgetHolder_.getView()
}var d=function(o){if(typeof o!=="undefined"&&o!=null){var m=o.aliases||[];
for(var n=0;
n<m.length;
n++){if(i[osapi.container.MetadataResponse.VIEWS][m[n]]){return{view:m[n],viewInfo:i[osapi.container.MetadataResponse.VIEWS][m[n]]}
}}}return null
};
var g=b[osapi.container.RenderParam.VIEW]||l[osapi.container.ViewParam.VIEW]||c;
var k=i[osapi.container.MetadataResponse.VIEWS][g];
if(g&&!k){var h=d(gadgets.config.get("views")[g]);
if(h){g=h.view;
k=h.viewInfo
}}if(!k&&b[osapi.container.RenderParam.ALLOW_DEFAULT_VIEW]&&g!=osapi.container.GadgetSite.DEFAULT_VIEW_){g=osapi.container.GadgetSite.DEFAULT_VIEW_;
k=i[osapi.container.MetadataResponse.VIEWS][g];
if(!k){var h=d(gadgets.config.get("views")[g]);
if(h){g=h.view;
k=h.viewInfo
}}}if(!k){gadgets.warn(["Unsupported view ",g," for gadget ",i.url,"."].join(""));
return
}if(this.currentGadgetHolder_&&!this.loadingGadgetEl_){this.loadingGadgetHolder_=this.currentGadgetHolder_;
this.currentGadgetHolder_=null
}else{var a=this.loadingGadgetEl_||this.el_;
this.loadingGadgetHolder_=new osapi.container.GadgetHolder(this,a,this.gadgetOnLoad_)
}var e={};
for(var j in b){e[j]=b[j]
}e[osapi.container.RenderParam.VIEW]=g;
e[osapi.container.RenderParam.HEIGHT]=b[osapi.container.RenderParam.HEIGHT]||k[osapi.container.MetadataResponse.PREFERRED_HEIGHT]||i[osapi.container.MetadataResponse.MODULE_PREFS][osapi.container.MetadataResponse.HEIGHT]||String(osapi.container.GadgetSite.DEFAULT_HEIGHT_);
e[osapi.container.RenderParam.WIDTH]=b[osapi.container.RenderParam.WIDTH]||k[osapi.container.MetadataResponse.PREFERRED_WIDTH]||i[osapi.container.MetadataResponse.MODULE_PREFS][osapi.container.MetadataResponse.WIDTH]||String(osapi.container.GadgetSite.DEFAULT_WIDTH_);
this.updateSecurityToken_(i,e);
this.loadingGadgetHolder_.render(i,l,e);
this.onRender(i,l,b)
};
osapi.container.GadgetSite.prototype.onRender=function(b,a,c){this.swapBuffers_();
if(this.currentGadgetHolder_){this.currentGadgetHolder_.dispose()
}this.currentGadgetHolder_=this.loadingGadgetHolder_;
this.loadingGadgetHolder_=null
};
osapi.container.GadgetSite.prototype.rpcCall=function(a,c,b){if(this.currentGadgetHolder_){gadgets.rpc.call(this.currentGadgetHolder_.getIframeId(),a,c,b)
}};
osapi.container.GadgetSite.prototype.updateSecurityToken_=function(d,e){var b=osapi.container.util.buildTokenRequestUrl(d.url,this.moduleId_),a=this.service_.getCachedGadgetToken(b);
if(a){var c=a[osapi.container.TokenResponse.TOKEN];
this.loadingGadgetHolder_.setSecurityToken(c)
}};
osapi.container.GadgetSite.prototype.close=function(){if(this.loadingGadgetHolder_){this.loadingGadgetHolder_.dispose()
}if(this.currentGadgetHolder_){this.currentGadgetHolder_.dispose()
}};
osapi.container.GadgetSite.prototype.swapBuffers_=function(){if(this.loadingGadgetEl_){this.loadingGadgetEl_.style.left="";
this.loadingGadgetEl_.style.position="";
this.el_.style.position="absolute";
this.el_.style.left="-2000px";
var a=this.el_;
this.el_=this.loadingGadgetEl_;
this.loadingGadgetEl_=a
}};
osapi.container.GadgetSite.RPC_ARG_KEY="gs";
osapi.container.GadgetSite.DEFAULT_HEIGHT_=200;
osapi.container.GadgetSite.DEFAULT_WIDTH_=320;
osapi.container.GadgetSite.DEFAULT_VIEW_="default";;

/* [end] feature=container.site.gadget */

/* [start] feature=container.site.url */
osapi.container.UrlHolder=function(a,d,c){osapi.container.SiteHolder.call(this,a,d,c);
var b;
this.url_=b;
this.onConstructed()
};
osapi.container.UrlHolder.prototype=new osapi.container.SiteHolder;
osapi.container.UrlHolder.prototype.dispose=function(){osapi.container.SiteHolder.prototype.dispose.call(this);
this.url_=null
};
osapi.container.UrlHolder.prototype.getIframeElement=function(){return this.el_.firstChild
};
osapi.container.UrlHolder.prototype.getUrl=function(){return this.url_
};
osapi.container.UrlHolder.prototype.render=function(a,b){this.iframeId_=osapi.container.UrlHolder.IFRAME_PREFIX_+this.site_.getId();
this.renderParams_=b;
this.el_.innerHTML=this.createIframeHtml(this.url_=a,{scrolling:"auto"})
};
osapi.container.UrlHolder.IFRAME_PREFIX_="__url_";;
osapi.container.UrlSite=function(b,a,c){var d;
osapi.container.Site.call(this,b,a,c[osapi.container.UrlSite.URL_ELEMENT]);
this.holder_=d;
this.url_=d;
this.onConstructed()
};
osapi.container.UrlSite.prototype=new osapi.container.Site;
osapi.container.UrlSite.prototype.getActiveSiteHolder=function(){return this.holder_
};
osapi.container.UrlSite.prototype.render=function(b,d){this.holder_=new osapi.container.UrlHolder(this,this.el_);
var a={};
for(var c in d){a[c]=d[c]
}this.holder_.render(b,a)
};
osapi.container.UrlSite.URL_ELEMENT="urlEl";;

/* [end] feature=container.site.url */

/* [start] feature=container */
osapi.container.Service=function(a){this.container_=a;
var b=this.config_=a.config_||{};
var c=((gadgets.config.get("osapi")||{}).endPoints||[window.__API_URI.getOrigin()+"/rpc"])[0];
var d=/^([^\/]*\/\/[^\/]+)(.*)$/.exec(c);
this.apiHost_=String(osapi.container.util.getSafeJsonValue(b,osapi.container.ServiceConfig.API_HOST,d[1]));
this.apiPath_=String(osapi.container.util.getSafeJsonValue(b,osapi.container.ServiceConfig.API_PATH,d[2]));
this.cachedMetadatas_={};
this.cachedTokens_={};
if(b.GET_LANGUAGE){this.getLanguage=b.GET_LANGUAGE
}if(b.GET_COUNTRY){this.getCountry=b.GET_COUNTRY
}this.registerOsapiServices();
this.onConstructed(b)
};
osapi.container.Service.prototype.onConstructed=function(a){};
osapi.container.Service.prototype.getGadgetMetadata=function(c,b){var f=b||function(){};
var e=osapi.container.util.toArrayOfJsonKeys(this.getUncachedDataByRequest_(this.cachedMetadatas_,c));
var d=this.getCachedDataByRequest_(this.cachedMetadatas_,c);
if(e.length==0){f(d)
}else{var a=this;
c.ids=e;
c.language=this.getLanguage();
c.country=this.getCountry();
this.updateContainerSecurityToken(function(g){if(g){for(var h=0;
h<c.ids.length;
h++){var j=c.ids[h];
d[j]={error:g}
}f(d)
}else{osapi.gadgets["metadata"](c).execute(function(k){if(k.error){for(var l=0;
l<c.ids.length;
l++){var o=c.ids[l];
d[o]={error:k.error}
}}else{var n=osapi.container.util.getCurrentTimeMs();
for(var o in k){var m=k[o];
a.updateResponse_(m,o,n);
a.cachedMetadatas_[o]=m;
d[o]=m
}}f(d)
})
}})
}};
osapi.container.Service.prototype.addGadgetMetadatas=function(a,b){this.addToCache_(a,b,this.cachedMetadatas_)
};
osapi.container.Service.prototype.addGadgetTokens=function(a,b){this.addToCache_(a,b,this.cachedTokens_)
};
osapi.container.Service.prototype.addToCache_=function(b,c,a){var f=osapi.container.util.getCurrentTimeMs();
for(var e in b){var d=b[e];
this.updateResponse_(d,e,f,c);
a[e]=d
}};
osapi.container.Service.prototype.updateResponse_=function(b,d,c,a){b[osapi.container.MetadataParam.URL]=d;
b[osapi.container.MetadataParam.LOCAL_EXPIRE_TIME]=b[osapi.container.MetadataResponse.EXPIRE_TIME_MS]-(a==null?b[osapi.container.MetadataResponse.RESPONSE_TIME_MS]:a)+c
};
osapi.container.Service.prototype.getGadgetToken=function(c,b){var e=b||function(){};
var a=this;
var d=function(f){var k={};
if(f.error){for(var j=0;
j<c.ids.length;
j++){k[c.ids[j]]={error:f.error}
}}else{for(var l in f){var h=f[osapi.container.TokenResponse.MODULE_ID],g=osapi.container.util.buildTokenRequestUrl(l,h);
a.cachedTokens_[g]=f[l];
k[l]=f[l]
}}e(k)
};
a.updateContainerSecurityToken(function(f){if(f){d({error:f})
}else{if(a.config_[osapi.container.ContainerConfig.GET_GADGET_TOKEN]){a.config_[osapi.container.ContainerConfig.GET_GADGET_TOKEN](c,d)
}else{osapi.gadgets["token"](c).execute(d)
}}})
};
osapi.container.Service.prototype.getCachedGadgetMetadata=function(a){return this.cachedMetadatas_[a]
};
osapi.container.Service.prototype.getCachedGadgetToken=function(a){return this.cachedTokens_[a]
};
osapi.container.Service.prototype.uncacheStaleGadgetMetadataExcept=function(c){for(var a in this.cachedMetadatas_){if(typeof c[a]==="undefined"){var b=this.cachedMetadatas_[a];
if(b[osapi.container.MetadataParam.LOCAL_EXPIRE_TIME]<osapi.container.util.getCurrentTimeMs()){delete this.cachedMetadatas_[a]
}}}};
osapi.container.Service.prototype.registerOsapiServices=function(){var b=this.apiHost_+this.apiPath_;
var a={};
a["gadgets.rpc"]=["container.listMethods"];
a[b]=["gadgets.metadata","gadgets.token"];
gadgets.config.init({osapi:{endPoints:[b]},"osapi.services":a})
};
osapi.container.Service.prototype.getCachedDataByRequest_=function(a,b){return this.filterCachedDataByRequest_(a,b,function(c){return(typeof c!=="undefined")
})
};
osapi.container.Service.prototype.getUncachedDataByRequest_=function(a,b){return this.filterCachedDataByRequest_(a,b,function(c){return(typeof c==="undefined")
})
};
osapi.container.Service.prototype.filterCachedDataByRequest_=function(f,c,e){var a={};
for(var b=0;
b<c.ids.length;
b++){var g=c.ids[b];
var d=f[g];
if(e(d)){a[g]=d
}}return a
};
osapi.container.Service.prototype.getLocale_=function(){var a=window.navigator;
return a.userLanguage||a.systemLanguage||a.language
};
osapi.container.Service.prototype.getLanguage=function(){try{return this.getLocale_().split("-")[0]||"ALL"
}catch(a){return"ALL"
}};
osapi.container.Service.prototype.getCountry=function(){try{return this.getLocale_().split("-")[1]||"ALL"
}catch(a){return"ALL"
}};
(function(){var c,a,b,g=1800000*0.8,e=[];
function f(i,h){while(i.length){i.shift().call(null,h)
}}function d(j){var h=this;
if(c){clearTimeout(c);
c=0
}var i=j||this.config_[osapi.container.ContainerConfig.GET_CONTAINER_TOKEN];
if(i){if(!b){b=true;
i(function(m,k,l){b=false;
g=typeof(k)=="number"?(k*1000*0.8):g;
if(g){c=setTimeout(gadgets.util.makeClosure(h,d,null),g)
}if(m){shindig.auth.updateSecurityToken(m);
a=osapi.container.util.getCurrentTimeMs();
f(e)
}else{if(l){f(e,l)
}}})
}}else{b=false;
f(e)
}}osapi.container.Service.prototype.updateContainerSecurityToken=function(p,j,i){var k,h=osapi.container.util.getCurrentTimeMs(),l=typeof(j)!="boolean"&&j||k,n=typeof(j)=="boolean"&&j,m=g&&(b||l||!a||h>a+g);
if(m){var o=!a||h>a+(g*95/80);
if(!o&&p){p()
}else{if(p){e.push(p)
}}if(l){d.call(this,function(q){q(l,i)
})
}else{if(!b&&!n){d.call(this)
}}}else{if(p){p()
}}}
})();;
osapi.container.Container=function(a){var c=this.config_=a||{};
this.gadgetLifecycleCallbacks_={};
this.preloadedGadgetUrls_={};
this.sites_={};
this.allowDefaultView_=Boolean(osapi.container.util.getSafeJsonValue(c,osapi.container.ContainerConfig.ALLOW_DEFAULT_VIEW,true));
this.renderCajole_=Boolean(osapi.container.util.getSafeJsonValue(c,osapi.container.ContainerConfig.RENDER_CAJOLE,false));
this.renderDebugParam_=String(osapi.container.util.getSafeJsonValue(c,osapi.container.ContainerConfig.RENDER_DEBUG_PARAM,osapi.container.ContainerConfig.RENDER_DEBUG));
var d=window.__CONTAINER_URI.getQP(this.renderDebugParam_);
this.renderDebug_=(typeof d==="undefined")?Boolean(osapi.container.util.getSafeJsonValue(c,osapi.container.ContainerConfig.RENDER_DEBUG,false)):(d==="1");
this.renderTest_=Boolean(osapi.container.util.getSafeJsonValue(c,osapi.container.ContainerConfig.RENDER_TEST,false));
this.tokenRefreshInterval_=Number(osapi.container.util.getSafeJsonValue(c,osapi.container.ContainerConfig.TOKEN_REFRESH_INTERVAL,0));
this.lastRefresh_=0;
this.navigateCallback_=String(osapi.container.util.getSafeJsonValue(c,osapi.container.ContainerConfig.NAVIGATE_CALLBACK,null));
this.service_=new osapi.container.Service(this);
this.tokenRefreshTimer_=null;
var b=this;
window[osapi.container.CallbackType.GADGET_ON_LOAD]=function(e,f){b.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_RENDER,e,f)
};
this.initializeMixins_();
this.setupRpcArbitrator_(c);
this.preloadCaches(c);
this.registerRpcServices_();
this.onConstructed(c)
};
osapi.container.Container.prototype.newGadgetSite=function(c,a){var d=a||null;
var b=new osapi.container.GadgetSite(this,this.service_,{navigateCallback:this.navigateCallback_,gadgetEl:c,bufferEl:d,gadgetOnLoad:osapi.container.CallbackType.GADGET_ON_LOAD});
this.sites_[b.getId()]=b;
return b
};
osapi.container.Container.prototype.navigateGadget=function(a,j,i,b,f){var g=f||function(){},e=osapi.container.ContainerConfig,d=osapi.container.RenderParam;
if(this.allowDefaultView_){b[d.ALLOW_DEFAULT_VIEW]=true
}if(this.renderCajole_){b[d.CAJOLE]=true
}if(this.renderDebug_){b[d.NO_CACHE]=true;
b[d.DEBUG]=true
}if(this.renderTest_){b[d.TEST_MODE]=true
}this.refreshService_();
var h=this,c=function(k){b[d.USER_PREFS]=k;
h.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_BEFORE_NAVIGATE,j,a.getId());
a.navigateTo(j,i,b,function(l){if(l.error){gadgets.warn(["Failed to possibly schedule token refresh for gadget ",j,"."].join(""))
}else{if(l[osapi.container.MetadataResponse.NEEDS_TOKEN_REFRESH]){h.scheduleRefreshTokens_(l[osapi.container.MetadataResponse.TOKEN_TTL])
}}h.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_NAVIGATED,a);
g(l)
})
};
if(this.config_[e.GET_PREFERENCES]&&!b[d.USER_PREFS]){this.config_[e.GET_PREFERENCES](a.getId(),j,c)
}else{c(b[d.USER_PREFS])
}};
osapi.container.Container.prototype.closeGadget=function(a){var b=a.getId();
this.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_BEFORE_CLOSE,a);
a.close();
this.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_CLOSED,a);
delete this.sites_[b];
if(a instanceof osapi.container.GadgetSite){this.unscheduleRefreshTokens_()
}};
osapi.container.Container.prototype.addGadgetLifecycleCallback=function(b,a){if(!this.gadgetLifecycleCallbacks_[b]){this.gadgetLifecycleCallbacks_[b]=a;
return true
}return false
};
osapi.container.Container.prototype.removeGadgetLifecycleCallback=function(a){delete this.gadgetLifecycleCallbacks_[a]
};
osapi.container.Container.prototype.preloadGadget=function(a,b){this.preloadGadgets([a],b)
};
osapi.container.Container.prototype.preloadGadgets=function(c,b){var e=b||function(){};
var d=osapi.container.util.newMetadataRequest(c);
var a=this;
this.refreshService_();
this.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_BEFORE_PRELOAD,c);
this.service_.getGadgetMetadata(d,function(f){a.addPreloadGadgets_(f);
a.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_PRELOADED,f);
e(f)
})
};
osapi.container.Container.prototype.unloadGadget=function(a){this.unloadGadgets([a])
};
osapi.container.Container.prototype.unloadGadgets=function(c){for(var b=0;
b<c.length;
b++){var a=c[b];
this.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_BEFORE_UNLOAD,a);
delete this.preloadedGadgetUrls_[a];
this.applyLifecycleCallbacks_(osapi.container.CallbackType.ON_UNLOADED,a)
}};
osapi.container.Container.prototype.getGadgetMetadata=function(a,c){var b=osapi.container.util.newMetadataRequest([a]);
this.refreshService_();
this.service_.getGadgetMetadata(b,c)
};
osapi.container.Container.prototype.rpcRegister=function(a,c){var b=this;
return gadgets.rpc.register(a,function(){this[osapi.container.GadgetSite.RPC_ARG_KEY]=b.getGadgetSiteByIframeId_(this["f"]);
var d=[this];
for(var e=0;
e<arguments.length;
++e){d.push(arguments[e])
}return c.apply(b,d)
})
};
osapi.container.Container.prototype.onConstructed=function(a){};
osapi.container.Container.addMixin=function(b,c){var a=osapi.container.Container.prototype.mixins_;
if(a[b]){var d=a[b];
a[b]=function(e){d.call(this,e);
return c.call(this,e)
}
}else{osapi.container.Container.prototype.mixinsOrder_.push(b);
a[b]=c
}};
osapi.container.Container.prototype.mixins_={};
osapi.container.Container.prototype.mixinsOrder_=[];
osapi.container.Container.prototype.initializeMixins_=function(){var b=osapi.container.Container.prototype.mixins_,a=osapi.container.Container.prototype.mixinsOrder_;
for(var c=0;
c<a.length;
c++){var d=a[c];
this[d]=new b[d](this)
}};
osapi.container.Container.prototype.addPreloadGadgets_=function(a){for(var c in a){if(a[c].error){var b=["Failed to preload gadget ",c,"."].join("");
gadgets.warn(b);
b=["Detailed error: ",a[c].error.code||""," ",a[c].error.message||""].join("");
gadgets.log(b)
}else{this.addPreloadedGadgetUrl_(c);
if(a[c][osapi.container.MetadataResponse.NEEDS_TOKEN_REFRESH]){this.scheduleRefreshTokens_(a[c][osapi.container.MetadataResponse.TOKEN_TTL])
}}}};
osapi.container.Container.prototype.preloadCaches=function(b){var a=osapi.container.util.getSafeJsonValue(b,osapi.container.ContainerConfig.PRELOAD_METADATAS,{});
var d=osapi.container.util.getSafeJsonValue(b,osapi.container.ContainerConfig.PRELOAD_TOKENS,{});
var c=osapi.container.util.getSafeJsonValue(b,osapi.container.ContainerConfig.PRELOAD_REF_TIME,null);
this.service_.addGadgetMetadatas(a,c);
this.service_.addGadgetTokens(d,c);
this.addPreloadGadgets_(a)
};
osapi.container.Container.prototype.refreshService_=function(){var a=this.getActiveGadgetUrls_();
this.service_.uncacheStaleGadgetMetadataExcept(a)
};
osapi.container.Container.prototype.getGadgetSiteByIframeId_=function(d){for(var c in this.sites_){var a=this.sites_[c];
var b=a.getActiveSiteHolder();
if(b&&b.getIframeId()===d){return a
}}return null
};
osapi.container.Container.prototype.getSiteById=function(a){return this.sites_[a]
};
osapi.container.Container.prototype.updateContainerSecurityToken=function(c,b,a){this.service_.updateContainerSecurityToken(c,b,a)
};
osapi.container.Container.prototype.scheduleRefreshTokens_=function(g){var a=this,f=this.tokenRefreshInterval_,d=g?this.setRefreshTokenInterval_(g*1000):f,c=function(){function h(i){if(i){setTimeout(gadgets.util.makeClosure(a,a.updateContainerSecurityToken,h,true),1)
}else{a.lastRefresh_=osapi.container.util.getCurrentTimeMs();
a.tokenRefreshTimer_=setTimeout(c,d);
a.refreshTokens_()
}}a.updateContainerSecurityToken(h)
};
if(this.isRefreshTokensEnabled_()&&(!this.tokenRefreshTimer_||d!=f)){var b=osapi.container.util.getCurrentTimeMs();
if(!this.tokenRefreshTimer_){this.lastRefresh_=b;
this.tokenRefreshTimer_=setTimeout(c,d)
}else{var e=(this.lastRefresh_||0)+f;
if(e<b){e=b+d;
d=1
}if(e>b+d){clearTimeout(this.tokenRefreshTimer_);
this.tokenRefreshTimer_=setTimeout(c,d)
}}}};
osapi.container.Container.prototype.unscheduleRefreshTokens_=function(){if(this.tokenRefreshTimer_){var a=this.getTokenRefreshableGadgetUrls_();
if(a.length<=0){clearTimeout(this.tokenRefreshTimer_);
this.tokenRefreshTimer_=null
}}};
osapi.container.Container.prototype.isRefreshTokensEnabled_=function(){return this.tokenRefreshInterval_>0
};
osapi.container.Container.prototype.setRefreshTokenInterval_=function(b){if(b){b*=0.8;
var a=this.tokenRefreshInterval_;
if(a<0){return a
}else{return this.tokenRefreshInterval_=a==0?b:Math.min(a,b)
}}};
osapi.container.Container.prototype.registerRpcServices_=function(){var a=this;
this.rpcRegister("resize_iframe",function(c,d){var b=c[osapi.container.GadgetSite.RPC_ARG_KEY];
if(b){b.setHeight(d)
}});
this.rpcRegister("resize_iframe_width",function(c,d){var b=c[osapi.container.GadgetSite.RPC_ARG_KEY];
if(b){b.setWidth(d)
}return true
});
this.rpcRegister("set_pref",function(d,f,k){var c=d[osapi.container.GadgetSite.RPC_ARG_KEY];
var g=a.config_[osapi.container.ContainerConfig.SET_PREFERENCES];
if(c&&g){var h={};
for(var e=2,b=arguments.length;
e<b;
e+=2){h[arguments[e]]=arguments[e+1]
}g(c.getId(),c.getActiveSiteHolder().getUrl(),h)
}})
};
osapi.container.Container.prototype.setupRpcArbitrator_=function(c){var a=gadgets.config.get("container");
if(typeof a.enableRpcArbitration!=="undefined"&&a.enableRpcArbitration){var d=osapi.container.util.getSafeJsonValue(c,osapi.container.ContainerConfig.RPC_ARBITRATOR,null);
if(!d){var b=this;
d=function(j,k){var f=b.getGadgetSiteByIframeId_(k);
if(f&&f.getActiveSiteHolder()){var e=b.service_.getCachedGadgetMetadata(f.getActiveSiteHolder().getUrl());
if(!e.error&&e.rpcServiceIds){for(var g=0,h;
h=e.rpcServiceIds[g];
g++){if(h==j){return true
}}}}gadgets.warn("RPC call to "+j+" was not allowed.");
return false
}
}gadgets.rpc.config({arbitrator:d})
}};
osapi.container.Container.prototype.addPreloadedGadgetUrl_=function(a){this.preloadedGadgetUrls_[a]=null
};
osapi.container.Container.prototype.getTokenRefreshableGadgetUrls_=function(){var a={};
for(var c in this.getActiveGadgetUrls_()){var e=this.service_.getCachedGadgetMetadata(c);
if(e[osapi.container.MetadataResponse.NEEDS_TOKEN_REFRESH]){a[c]=1
}}for(var f in this.sites_){var b=this.sites_[f];
if(b instanceof osapi.container.GadgetSite){var d=b.getActiveSiteHolder();
if(d){var c=d.getUrl();
mid=b.getModuleId();
if(a[c]){a[osapi.container.util.buildTokenRequestUrl(c,mid)]=1
}}}}return osapi.container.util.toArrayOfJsonKeys(a)
};
osapi.container.Container.prototype.getActiveGadgetUrls_=function(){return osapi.container.util.mergeJsons(this.getNavigatedGadgetUrls_(),this.preloadedGadgetUrls_)
};
osapi.container.Container.prototype.getNavigatedGadgetUrls_=function(){var a={};
for(var d in this.sites_){var b=this.sites_[d];
if(b instanceof osapi.container.GadgetSite){var c=b.getActiveSiteHolder();
if(c){a[c.getUrl()]=1
}}}return a
};
osapi.container.Container.prototype.refreshTokens_=function(){var b=this.getTokenRefreshableGadgetUrls_();
var c=osapi.container.util.newTokenRequest(b);
var a=this;
this.service_.getGadgetToken(c,function(e){for(var k in a.sites_){var h=a.sites_[k];
if(h instanceof osapi.container.GadgetSite){var i=h.getActiveSiteHolder();
if(i){var j=a.service_.getCachedGadgetMetadata(i.getUrl());
if(j[osapi.container.MetadataResponse.NEEDS_TOKEN_REFRESH]){var g=h.getModuleId(),f=osapi.container.util.buildTokenRequestUrl(i.getUrl(),g),d=e[f];
if(d.error){gadgets.warn(["Failed to get token for gadget ",f,"."].join(""))
}else{gadgets.rpc.call(i.getIframeId(),"update_security_token",null,d[osapi.container.TokenResponse.TOKEN])
}}}}}})
};
osapi.container.Container.prototype.applyLifecycleCallbacks_=function(a){var b=Array.prototype.slice.call(arguments,1);
for(name in this.gadgetLifecycleCallbacks_){var c=this.gadgetLifecycleCallbacks_[name][a];
if(c){c.apply(null,b)
}}};
osapi.container.Container.prototype.newUrlSite=function(c){var b={};
b[osapi.container.UrlSite.URL_ELEMENT]=c;
var a=new osapi.container.UrlSite(this,this.service_,b);
this.sites_[a.getId()]=a;
return a
};
osapi.container.Container.prototype.navigateUrl=function(b,a,c){b.render(a,c);
return b
};;
gadgets.config.register("container",null,function(a){var e=a.container.jsPath||null;
window.__CONTAINER_URI=shindig.uri(window.location.href);
window.__API_URI=null;
var c=null;
if(window.__CONTAINER_SCRIPT_ID){c=document.getElementById(window.__CONTAINER_SCRIPT_ID)
}else{var g=document.getElementsByTagName("script");
for(var b=0;
g&&b<g.length;
b++){var f=g[b].src,d=e!=null&&f&&f.indexOf(e)||-1;
if(d!=-1&&/.*container.*[.]js.*[?&]c=1(#|&|$).*/.test(f.substring(d+e.length))){c=g[b];
break
}}}if(c){window.__API_URI=shindig.uri(c.src);
window.__API_URI.resolve(window.__CONTAINER_URI)
}window.__CONTAINER=window.__API_URI?window.__API_URI.getQP("container"):"default"
},false);;

/* [end] feature=container */

/* [start] feature=open-views.common */
osapi.container.Container.addMixin("views",function(a){var b=this;
a.rpcRegister("gadgets.views.close",function(e,f){var c=a.getGadgetSiteByIframeId_(e.f),d=typeof(f)!="undefined"&&f!=null?a.getSiteById(f):c;
if(d&&(d==c||d.ownerId_==e.f)){b.destroyElement(d)
}});
a.rpcRegister("gadgets.window.getContainerDimensions",function(c){var d=document.documentElement;
return{width:d?d.clientWidth:-1,height:d?d.clientHeight:-1}
});
this.destroyElement=function(c){console.log("container needs to define destroyElement function")
}
});;

/* [end] feature=open-views.common */

/* [start] feature=open-views.results */
osapi.container.Container.addMixin("views",function(b){this.resultCallbacks_={};
this.returnValues_={};
var c=this,a={};
a[osapi.container.CallbackType.ON_BEFORE_CLOSE]=function(e){var g=e.getId(),f=c.returnValues_[g],d=c.resultCallbacks_[g];
if(typeof d!=="undefined"){if(e.ownerId_){gadgets.rpc.call(e.ownerId_,"gadgets.views.deliverResult",null,d,f)
}}delete c.returnValues_[g];
delete c.resultCallbacks_[g]
};
b.addGadgetLifecycleCallback("open-views",a);
b.rpcRegister("gadgets.views.setReturnValue",function(e,f){var d=b.getGadgetSiteByIframeId_(e.f);
if(d){c.returnValues_[d.getId()]=f
}})
});;

/* [end] feature=open-views.results */

/* [start] feature=embedded-experiences */
osapi.container.ee={};
osapi.container.ee.RenderParam={GADGET_RENDER_PARAMS:"gadgetRenderParams",GADGET_VIEW_PARAMS:"gadgetViewParams",URL_RENDER_PARAMS:"urlRenderParams",DATA_MODEL:"eeDataModel",EMBEDDED:"embedded"};
osapi.container.ee.DataModel={CONTEXT:"context",GADGET:"gadget",URL:"url",PREVIEW_IMAGE:"previewImage",PREFERRED_EXPERIENCE:"preferredExperience"};
osapi.container.ee.PreferredExperience={TARGET:"target",DISPLAY:"display",TYPE:"type",VIEW:"view",VIEW_TARGET:"viewTarget"};
osapi.container.ee.Context={ASSOCIATED_CONTEXT:"associatedContext",OPENSOCIAL:"openSocial"};
osapi.container.ee.AssociatedContext={ID:"id",TYPE:"type",OBJECT_REFERENCE:"objectReference"};
osapi.container.ee.TargetType={GADGET:"gadget",URL:"url"};
osapi.container.ee.DisplayType={IMAGE:"image",TEXT:"text"};
osapi.container.ee.ContainerConfig={GET_EE_NAVIGATION_TYPE:"GET_EE_NAVIGATION_TYPE"};;
(function(){osapi.container.Container.addMixin("ee",function(a){var i=osapi.container.ee.DataModel;
var b=osapi.container.ee.PreferredExperience;
var e=osapi.container.ee.TargetType;
var d=osapi.container.ee.Context;
var f=osapi.container.ee.ContainerConfig;
function g(n,q,m,s,v){var w=m[osapi.container.ee.RenderParam.GADGET_VIEW_PARAMS]||{};
var o=m[osapi.container.ee.RenderParam.GADGET_RENDER_PARAMS]||{};
o[osapi.container.RenderParam.VIEW]=osapi.container.ee.RenderParam.EMBEDDED;
var p=q[i.PREFERRED_EXPERIENCE];
if(p){var r=p[b.TARGET];
if(r&&r[b.TYPE]===e.GADGET){if(!!r[b.VIEW]){o[osapi.container.RenderParam.VIEW]=r[b.VIEW]
}}}if(v){var u=q[i.CONTEXT];
var y=true;
if(u){if(typeof u!="object"){y=false
}}else{u={}
}if(y){var k={};
k[d.ASSOCIATED_CONTEXT]={};
for(var t in v){if(v.hasOwnProperty(t)){k[t]=v[t]
}}u[d.OPENSOCIAL]=k;
q[i.CONTEXT]=u
}}o[osapi.container.ee.RenderParam.DATA_MODEL]=q;
var l=a.newGadgetSite(n);
var x=q[i.GADGET];
a.preloadGadget(x,function(z){if(!z[x]||z[x].error){if(q[i.URL]!=null){j(n,q,m,s)
}else{if(s!=null){s(l,z[x]||{error:z})
}}}else{a.navigateGadget(l,x,w,o,function(A){if(s!=null){s(l,A)
}})
}})
}function j(n,m,p,k){var o=p[osapi.container.ee.RenderParam.URL_RENDER_PARAMS]||{};
var l=a.newUrlSite(n);
var q=a.navigateUrl(l,m[i.URL],o);
if(k){k(q,null)
}}function c(l){if(l[i.PREFERRED_EXPERIENCE]){var k=l[i.PREFERRED_EXPERIENCE];
if(k[b.TARGET]){var n=k[b.TARGET];
if(n&&n[b.TYPE]){var m=n[b.TYPE];
if((osapi.container.ee.TargetType.URL===m&&typeof l.url!=="undefined")||(osapi.container.ee.TargetType.GADGET===m&&typeof l.gadget!=="undefined")){return m
}}}}return null
}function h(l){var k=l.gs;
var n=k.currentGadgetHolder_.renderParams_;
var m=n.eeDataModel;
return m?m[i.CONTEXT]:null
}a.rpcRegister("ee_gadget_rendered",h);
return{navigate:function(n,m,p,l,k){var o=null;
if(!!a.config_&&!!a.config_[f.GET_EE_NAVIGATION_TYPE]&&(typeof a.config_[f.GET_EE_NAVIGATION_TYPE]==="function")){o=a.config_[f.GET_EE_NAVIGATION_TYPE].call(a,m)
}else{o=c(m)
}if(o===null){if(m[i.GADGET]){o=osapi.container.ee.TargetType.GADGET
}else{if(m[i.URL]){o=osapi.container.ee.TargetType.URL
}}}if(o===osapi.container.ee.TargetType.GADGET){g(n,m,p,l,k)
}else{if(o===osapi.container.ee.TargetType.URL){j(n,m,p,l)
}}},close:function(k){if(k instanceof osapi.container.GadgetSite){a.closeGadget(k)
}if(k instanceof osapi.container.UrlSite){k.close()
}}}
})
})();;

/* [end] feature=embedded-experiences */

/* [start] feature=gadgets.json.ext */
gadgets.json.xml=(function(){var d=3;
function b(k,i){for(var h=0;
h<k.length;
h++){var j=k[h];
if(j.nodeType==d){g(i,j.nodeName,j)
}else{if(j.childNodes.length==0){if(j.attributes!=null&&j.attributes.length!=0){a(j,i)
}else{i[j.nodeName]=null
}}else{if(j.childNodes.length==1&&j.firstChild.nodeType==d&&(j.attributes==null||j.attributes.length==0)){g(i,j.nodeName,j.firstChild)
}else{c(i,j)
}}}}}function c(i,k){var j=i[k.nodeName];
if(j==null){i[k.nodeName]={};
if(k.attributes!=null&&k.attributes.length!=0){e(k.attributes,i[k.nodeName])
}b(k.childNodes,i[k.nodeName])
}else{var h={};
if(k.attributes!=null&&k.attributes.length!=0){e(k.attributes,h)
}b(k.childNodes,h);
i[k.nodeName]=f(j,h)
}}function g(h,k,j){var i=h[k];
if(i!=null){h[k]=f(i,j.nodeValue)
}else{h[k]=j.nodeValue
}}function f(h,i){if(h instanceof Array){h[h.length]=i;
return h
}else{return new Array(h,i)
}}function a(k,i){var j=i[k.nodeName];
if(j==null){i[k.nodeName]={};
e(k.attributes,i[k.nodeName])
}else{var h={};
e(k.attributes,h);
i[k.nodeName]=f(j,h)
}}function e(h,j){var k=null;
for(var i=0;
i<h.length;
i++){k=h[i];
j["@"+k.nodeName]=k.nodeValue
}}return{convertXmlToJson:function(i){var j=i.childNodes;
var h={};
b(j,h);
return h
}}
})();;

/* [end] feature=gadgets.json.ext */

/* [start] feature=xmlutil */
var opensocial=opensocial||{};
opensocial.xmlutil=opensocial.xmlutil||{};
opensocial.xmlutil.parser_=null;
opensocial.xmlutil.parseXML=function(b){if(typeof(DOMParser)!="undefined"){opensocial.xmlutil.parser_=opensocial.xmlutil.parser_||new DOMParser();
var a=opensocial.xmlutil.parser_.parseFromString(b,"text/xml");
if(a.firstChild&&a.firstChild.tagName=="parsererror"){throw Error(a.firstChild.firstChild.nodeValue)
}return a
}else{if(typeof(ActiveXObject)!="undefined"){var a=new ActiveXObject("MSXML2.DomDocument");
a.validateOnParse=false;
a.loadXML(b);
if(a.parseError&&a.parseError.errorCode){throw Error(a.parseError.reason)
}return a
}}throw Error("No XML parser found in this browser.")
};
opensocial.xmlutil.NSMAP={os:"http://opensocial.org/"};
opensocial.xmlutil.getRequiredNamespaces=function(b,a){var d=a?opensocial.xmlutil.getNamespaceDeclarations_(a):{};
for(var c in opensocial.xmlutil.NSMAP){if(opensocial.xmlutil.NSMAP.hasOwnProperty(c)&&!d.hasOwnProperty(c)&&b.indexOf("<"+c+":")>=0&&b.indexOf("xmlns:"+c+":")<0){d[c]=opensocial.xmlutil.NSMAP[c]
}}return opensocial.xmlutil.serializeNamespaces_(d)
};
opensocial.xmlutil.serializeNamespaces_=function(c){var a=[];
for(var b in c){if(c.hasOwnProperty(b)){a.push(" xmlns:",b,'="',c[b],'"')
}}return a.join("")
};
opensocial.xmlutil.getNamespaceDeclarations_=function(c){var d={};
for(var b=0;
b<c.attributes.length;
b++){var a=c.attributes[b].nodeName;
if(a.substring(0,6)!="xmlns:"){continue
}d[a.substring(6,a.length)]=c.getAttribute(a)
}return d
};
opensocial.xmlutil.ENTITIES='<!ENTITY nbsp "&#160;">';
opensocial.xmlutil.prepareXML=function(b,a){var c=opensocial.xmlutil.getRequiredNamespaces(b,a);
return"<!DOCTYPE root ["+opensocial.xmlutil.ENTITIES+']><root xml:space="preserve"'+c+">"+b+"</root>"
};;

/* [end] feature=xmlutil */

/* [start] feature=open-views.ee */
osapi.container.Container.addMixin("views",function(a){var b=this;
a.rpcRegister("gadgets.views.openEmbeddedExperience",function(g,d,k,c){var l=g.callback,f=g.f,m=k.gadget;
if(typeof(k)=="string"){var e=new RegExp("^<(embed)>","i").exec(k);
if(e&&e[1]){try{var j=gadgets.json.xml.convertXmlToJson(opensocial.xmlutil.parseXML(k));
k=j&&j[e[1]]||k
}catch(h){}}else{try{var j=gadgets.json.parse(k);
k=j||k
}catch(h){}}}var i=function(p){var n="",u={},q;
if(c){if(c.viewTarget){n=c.viewTarget
}if(c.viewParams){u=c.viewParams
}if(c.coordinates){q=c.coordinates
}}var r=a.getGadgetSiteByIframeId_(f),v=r.getActiveSiteHolder().getIframeElement();
var t=b.getContainerAssociatedContext(k,p);
function s(x){var z={};
z[osapi.container.RenderParam.VIEW]=osapi.container.ee.RenderParam.EMBEDDED;
z[osapi.container.RenderParam.WIDTH]="100%";
z[osapi.container.RenderParam.HEIGHT]="100%";
var y={};
y[osapi.container.RenderParam.WIDTH]="100%";
y[osapi.container.RenderParam.HEIGHT]="100%";
var w={};
w[osapi.container.ee.RenderParam.GADGET_RENDER_PARAMS]=z;
w[osapi.container.ee.RenderParam.URL_RENDER_PARAMS]=y;
w[osapi.container.ee.RenderParam.GADGET_VIEW_PARAMS]=u;
a.ee.navigate(x,k,w,function(B,A){B.ownerId_=f;
if(A){b.resultCallbacks_[B.getId()]=d
}if(l){l([B.getId(),A])
}},t)
}var o=b.createElementForEmbeddedExperience(v,p,n,q,r,s);
if(o){s(o)
}};
if(m){a.preloadGadget(m,function(n){if(!n[m]||n[m].error){if(!k.url){if(l!=null){l([null,n[m]||{error:n}])
}return
}}i(n[m])
})
}else{i()
}});
this.createElementForEmbeddedExperience=function(c,f,h,e,g,d){console.log("container needs to define createElementForEmbeddedExperience function")
};
this.getContainerAssociatedContext=function(d,c){return null
}
});;

/* [end] feature=open-views.ee */

/* [start] feature=open-views.gadget */
osapi.container.Container.addMixin("views",function(a){var b=this;
a.rpcRegister("gadgets.views.openGadget",function(g,e,c){var h=g.callback,f=g.f,n="",k=a.getGadgetSiteByIframeId_(g.f);
if((typeof k!="undefined")&&(typeof k.getActiveSiteHolder()!="undefined")){n=k.getActiveSiteHolder().getUrl()
}var i="",d="",m={},j;
if(c){if(c.view){i=c.view
}if(c.viewTarget){d=c.viewTarget
}if(c.viewParams){m=c.viewParams
}if(c.coordinates){j=c.coordinates
}}var l=a.getGadgetSiteByIframeId_(g.f).getActiveSiteHolder().getIframeElement();
a.preloadGadget(n,function(o){var p={};
if((typeof o!="undefined")&&(typeof o[n]!="undefined")){if(o[n].error){gadgets.error("Failed to preload gadget : "+n);
if(h!=null){h([null,o[n]])
}return
}else{p=o[n]
}}function r(t){var u={},s=a.newGadgetSite(t);
s.ownerId_=f;
if((typeof i!="undefined")&&i!==""){u[osapi.container.RenderParam.VIEW]=i
}u[osapi.container.RenderParam.WIDTH]="100%";
u[osapi.container.RenderParam.HEIGHT]="100%";
a.navigateGadget(s,n,m,u,function(v){if(v){b.resultCallbacks_[s.getId()]=e
}if(h){h([s.getId(),v])
}})
}var q=b.createElementForGadget(p,l,i,d,j,k,r);
if(q){r(q)
}})
});
this.createElementForGadget=function(f,c,g,i,e,h,d){console.log("container needs to define createElementForGadget function")
}
});;

/* [end] feature=open-views.gadget */

/* [start] feature=open-views.url */
osapi.container.Container.addMixin("views",function(a){var b=this;
a.rpcRegister("gadgets.views.openUrl",function(f,e,j,g){var d=a.getGadgetSiteByIframeId_(f.f),c=d.getActiveSiteHolder().getIframeElement();
function i(m){var k=a.newUrlSite(m);
var l={};
l[osapi.container.RenderParam.WIDTH]="100%";
l[osapi.container.RenderParam.HEIGHT]="100%";
a.navigateUrl(k,e,l);
k.ownerId_=f.f;
f.callback([k.getId()])
}var h=b.createElementForUrl(c,j,g,d,i);
if(h){i(h)
}});
this.createElementForUrl=function(c,g,e,f,d){console.log("container needs to define createElementForUrl function")
}
});;

/* [end] feature=open-views.url */

/* [start] feature=jive-core-container */
(function(){var a=shindig.uri(window.location.href);window.__API_URI=window.__JAF_DEBUG?shindig.uri("/../gadgets/js/jive-core-container:container:core:rpc:open-views:dynamic-height:selection:actions.js?c\x3d1\x26debug\x3d1\x26container\x3ddefault"):shindig.uri("/../gadgets/js/jive-core-container:container:core:rpc:open-views:dynamic-height:selection:actions.js?c\x3d1\x26container\x3ddefault");window.__API_URI.resolve(a);window.__CONTAINER="default"})();;

/* [end] feature=jive-core-container */

/* [start] feature=selection */
(function(){var b,a=[],d={};
function c(f){if(typeof f==="function"){a.push(f)
}}function e(h){for(var g=0,f;
f=a[g];
g++){if(f===h){a.splice(g,1);
break
}}}osapi.container.Container.addMixin("selection",function(f){function g(k){b=k;
for(var j=0,h;
h=a[j];
j++){a[j](k)
}for(var l in d){if(!f.getGadgetSiteByIframeId_(l)){delete d[l]
}else{gadgets.rpc.call(l,"gadgets.selection.selectionChanged",null,k)
}}}f.rpcRegister("gadgets.selection.set",function(h,i){g(i)
});
f.rpcRegister("gadgets.selection.register",function(h){d[h.f]=1;
return b
});
return{setSelection:g,getSelection:function(){return b
},addListener:c,removeListener:e}
})
})();;

/* [end] feature=selection */

/* [start] feature=actions */
osapi.container.actions={};
osapi.container.actions.OptParam={};
osapi.container.actions.OptParam.VIEW="view";
osapi.container.actions.OptParam.VIEW_TARGET="viewTarget";;
(function(){function q(w){var z=true;
if(!w){z=false
}else{var A=w.id,y=w.path,x=w.dataType;
if(!A||!(y||x)){z=false
}}return z
}function t(){this.registryById={};
this.registryByPath={};
this.registryByDataType={};
this.registryByUrl={};
this.urlToSite={};
this.actionToUrl={};
this.addAction=function(C,w){if(!q(C)){return
}var y=C.id,F=C.path,D=C.dataType;
if(F){var z=F.split("/");
var E=this.registryByPath;
for(var B=0;
B<z.length;
B++){var x=z[B];
if(!E[x]){E[x]={}
}E=E[x]
}var A=E["@actions"];
if(!A){E["@actions"]=[C]
}else{E["@actions"]=A.concat(C)
}}else{if(D){this.registryByDataType[D]=this.registryByDataType[D]?this.registryByDataType[D].concat(C):[C]
}}this.registryById[y]=C;
if(w){this.actionToUrl[y]=w;
this.registryByUrl[w]=this.registryByUrl[w]?this.registryByUrl[w].concat(C):[C]
}};
this.removeAction=function(w){var B=this.registryById[w];
delete this.registryById[w];
var F=B.path;
if(F){var z=this.getActionsByPath(F);
var A=z.indexOf(B);
if(A!=-1){z.splice(A,1)
}}else{var C=B.dataType;
var D=this.registryByDataType[C];
var E=D.indexOf(B);
D.splice(E,1);
if(D.length==0){delete this.registryByDataType[C]
}}var x=this.actionToUrl[w];
if(x){delete this.actionToUrl[w];
var y=this.registryByUrl[x];
var E=y.indexOf(B);
y.splice(E,1);
if(y.length==0){delete this.registryByUrl[x]
}}};
this.getItemById=function(x){var w=this.registryById?this.registryById:{};
return w[x]
};
this.getAllActions=function(){var w=[];
for(actionId in this.registryById){if(this.registryById.hasOwnProperty(actionId)){w=w.concat(this.registryById[actionId])
}}return w
};
this.getActionsByPath=function(A){var B=[];
var z=A.split("/");
var y=this.registryByPath?this.registryByPath:{};
for(var x=0;
x<z.length;
x++){var w=z[x];
if(y[w]){y=y[w]
}else{return B
}}if(y){B=y["@actions"]
}return B
};
this.getActionsByDataType=function(w){var x=[];
if(this.registryByDataType[w]){x=this.registryByDataType[w]
}return x
};
this.getActionsByUrl=function(w){var x=[];
if(this.registryByUrl[w]){x=x.concat(this.registryByUrl[w])
}return x
};
this.addGadgetSite=function(x,w){var y=this.urlToSite[x];
if(y){this.urlToSite[x]=y.concat(w)
}else{this.urlToSite[x]=[w]
}};
this.removeGadgetSite=function(A){for(var x in this.urlToSite){if(this.urlToSite.hasOwnProperty(x)){var z=this.urlToSite[x];
if(!z){continue
}for(var y=0;
y<z.length;
y++){var w=z[y];
if(w&&w.getId()==A){z.splice(y,1);
if(z.length==0){delete this.urlToSite[x]
}}}}}};
this.getGadgetSites=function(D){var B=this.getItemById(D);
var x=this.actionToUrl[D];
var C=[];
var A=this.urlToSite[x];
if(A){for(var z=0;
z<A.length;
z++){var w=A[z];
var y=w.getActiveSiteHolder();
if(!B.view||(y&&y.getView()===B.view)){C.push(w)
}}}return C
};
this.getUrl=function(w){return this.actionToUrl[w]
}
}function p(w){var z=w.id;
var y=j.getItemById(z);
if(!y){h(w)
}else{var x=o[z];
if(x){i(z,x.selection);
delete o[z]
}}}function h(w,x){if(!q(w)){return
}j.addAction(w,x);
g([w]);
for(var y in e){if(e.hasOwnProperty(y)){if(!v.getGadgetSiteByIframeId_(y)){delete e[y]
}else{gadgets.rpc.call(y,"actions.onActionShow",null,[w])
}}}}function n(y){var w=j.getItemById(y);
j.removeAction(y);
l([w]);
for(var x in s){if(s.hasOwnProperty(x)){if(!v.getGadgetSiteByIframeId_(x)){delete s[x]
}else{gadgets.rpc.call(x,"actions.onActionHide",null,[w])
}}}}var c={};
var m=[];
function i(D,B){if(!B&&v&&v.selection){B=v.selection.getSelection()
}var z=c[D];
var y;
if(z){for(y=0;
y<z.length;
y++){var C=z[y];
C.call(null,D,B)
}}for(y=0;
y<m.length;
y++){var C=m[y];
C.call(null,D,B)
}var A=j.getGadgetSites(D);
if(A){for(y=0;
y<A.length;
y++){var w=A[y];
var x=w.getActiveSiteHolder();
if(x){gadgets.rpc.call(x.getIframeId(),"actions.runAction",null,D,B)
}}}}function f(w){var x=w;
if(typeof x!=="string"){x=x.toString()
}x=x.replace(/\n/g,"");
x=x.replace(/\s+</g,"<");
x=x.replace(/>\s+/g,">");
if(x.indexOf("<actions>")===-1){x="<actions>"+x+"</actions>"
}return x
}var a=function(x){for(var w in x){if(!x.hasOwnProperty(w)){continue
}var E=x[w];
if(E.error||!E.modulePrefs){continue
}var J=E.modulePrefs.features.actions,C=J&&J.params?J.params["action-contributions"]:null;
if(!C){continue
}C=f(C);
var z;
try{z=opensocial.xmlutil.parseXML(C)
}catch(D){}if(!z){continue
}var H=gadgets.json.xml.convertXmlToJson(z),F=H.actions;
if(!F){continue
}var y=[].concat(F.action);
for(var A=0;
A<y.length;
A++){var B=y[A];
var I={};
for(var G in B){if(B.hasOwnProperty(G)){I[G.substring(1)]=B[G]
}}if(!j.getItemById(I.id)){h(I,w)
}else{gadgets.warn(["Duplicated gadget action [",I.id,"] detected, make sure the gadget actions have unique ids."].join(""))
}}}};
var u=function(x){var y=x.getActiveSiteHolder();
if(y){var w=y.getUrl();
j.addGadgetSite(w,x)
}};
var d=function(w){var x=w.getId();
j.removeGadgetSite(x)
};
var r=function(x){var w=j.getActionsByUrl(x);
for(var y=0;
y<w.length;
y++){var z=w[y];
n(z.id)
}};
var k={};
k[osapi.container.CallbackType.ON_PRELOADED]=a;
k[osapi.container.CallbackType.ON_NAVIGATED]=u;
k[osapi.container.CallbackType.ON_BEFORE_CLOSE]=d;
k[osapi.container.CallbackType.ON_UNLOADED]=r;
var g=function(w){},e={};
var l=function(w){},s={};
var b=function(w,x){};
var j=new t();
var o={};
var v=null;
osapi.container.Container.addMixin("actions",function(w){v=w;
v.rpcRegister("actions.registerHideCallback",function(x){s[x.f]=1
});
v.rpcRegister("actions.registerShowCallback",function(x){e[x.f]=1
});
v.rpcRegister("actions.bindAction",function(y,x){p(x)
});
v.rpcRegister("actions.get_actions_by_type",function(y,x){return[].concat(j.getActionsByDataType(x))
});
v.rpcRegister("actions.get_actions_by_path",function(x,y){return[].concat(j.getActionsByPath(y))
});
v.rpcRegister("actions.removeAction",function(x,y){return n(y)
});
v.rpcRegister("actions.runAction",function(x,z,y){v.actions.runAction(z,y)
});
if(v.addGadgetLifecycleCallback){v.addGadgetLifecycleCallback("actions",k)
}return{registerShowActionsHandler:function(x){if(typeof x==="function"){g=x
}},registerHideActionsHandler:function(x){if(typeof x==="function"){l=x
}},registerNavigateGadgetHandler:function(x){if(typeof x==="function"){b=x
}},runAction:function(C,z){var B=j.getItemById(C);
if(B){var y=j.getGadgetSites(C);
if(!y||(y.length===0)){var x=j.getUrl(C);
o[C]={selection:z||v.selection.getSelection()};
var A={};
if(B.view){A[osapi.container.actions.OptParam.VIEW]=B.view
}if(B.viewTarget){A[osapi.container.actions.OptParam.VIEW_TARGET]=B.viewTarget
}b(x,A)
}else{i(C,z)
}}},getAction:function(x){return j.getItemById(x)
},getAllActions:function(){return j.getAllActions()
},getActionsByPath:function(x){return j.getActionsByPath(x)
},getActionsByDataType:function(x){return j.getActionsByDataType(x)
},addListener:function(y,x){if(y&&typeof(y)!="function"){throw new Error("listener param must be a function")
}if(x){(c[x]=c[x]||[]).push(y)
}else{m.push(y)
}},removeListener:function(y){var x=listeners.indexOf(y);
if(x!=-1){listeners.splice(x,1)
}}}
})
})();;

/* [end] feature=actions */
gadgets.config.init({"container":{"relayPath":"https://community.esri.com/gadgets/files/container/rpc_relay.html","jsPath":"/gadgets/js","enableRpcArbitration":false},"core.io":{"unparseableCruft":"throw 1; \u003c don't be evil' \u003e","jsPath":"/gadgets/js","xhrPollIntervalMs":50,"jsonProxyUrl":"https://%host%/gadgets/makeRequest","proxyUrl":"https://%host%/gadgets/proxy?container=default&refresh=%refresh%&url=%url%%authz%%rewriteMime%"},"osapi.services":{"https://%host%/social/rpc":["jive.market.installMultiAppNonTransactional","jive.core.delete","jive.market.requestAppSync","albums.create","http.head","gadgets.token","activitystreams.supportedFields","jive.market.getSbsContext","activities.create","http.get","jive.market.installMultiApp","jive.core.patch","jive.version.getVersionInfo","mediaItems.delete","jive.ext.delete","people.get","jive.connects.get","jive.connects.reset","gadgets.supportedFields","gadgets.cajaSupportedFields","systemSettings.update","jive.market.installApp","jive.connects.delete","jive.core.get","mediaItems.update","groups.update","jive.market.uninstallApp","http.put","appdata.create","activitystreams.delete","http.delete","cache.invalidate","application.get","jive.connects.patch","systemSettings.create","jive.ext.post","jive.market.isCachingEnabled","albums.delete","groups.supportedFields","messages.delete","jive.connects.head","appdata.update","jive.ext.put","groups.create","people.update","activities.supportedFields","jive.connects.put","jive.connects.post","http.post","albums.get","jive.market.refreshApp","gadgets.proxySupportedFields","gadgets.cajole","people.supportedFields","jive.dev.isCachingEnabled","gadgets.metadata","jive.binary.metadata","albums.supportedFields","albums.update","activities.delete","mediaItems.get","groups.get","jive.core.post","jive.dev.setCachingEnabled","jive.market.setCachingEnabled","gadgets.proxy","activities.update","jive.connects.pooled","jive.binary.token","activitystreams.create","activitystreams.get","jive.connects.connection","jive.core.put","jive.ext.patch","jive.connects.update","messages.get","activitystreams.update","jive.market.getAppInstances","mediaItems.create","messages.create","gadgets.jsSupportedFields","systemSettings.delete","groups.delete","jive.connects.configuration","gadgets.tokenSupportedFields","activities.get","gadgets.js","jive.ext.get","appdata.get","appdata.delete","systemSettings.get","jive.market.publishExtension","jive.connects.statistics","system.listMethods"]},"opensocial":{"path":"https://%host%/social/rpc","invalidatePath":"https://community.esri.com/gadgets/api/rpc","domain":"shindig","enableCaja":false,"supportedFields":{"activity":["appId","body","bodyId","externalId","id","mediaItems","postedTime","priority","streamFaviconUrl","streamSourceUrl","streamTitle","streamUrl","templateParams","title","url","userId"],"person":["id",{"name":["familyName","givenName","unstructured"]},"emails","thumbnailUrl","profileUrl","aboutMe","hasApp","photos","jive_enabled"],"album":["id","thumbnailUrl","title","description","location","ownerId"],"mediaItem":["album_id","created","description","duration","file_size","id","language","last_updated","location","mime_type","num_comments","num_views","num_votes","rating","start_time","tagged_people","tags","thumbnail_url","title","type","url"],"group":["id","title","description"],"activityEntry":["actor","content","generator","icon","id","object","published","provider","target","title","updated","url","verb","openSocial","extensions"]}},"rpc":{"useLegacyProtocol":false,"commSwf":"https://community.esri.com/gadgets/xpc.swf","passReferrer":"c2p:query","parentRelayUrl":"/gadgets/ifpc.relay.html"},"osapi":{"endPoints":["https://%host%/social/rpc"]},"views":{"default":{"aliases":["DEFAULT","profile"],"urlTemplate":"https://community.esri.com/gadgets/default?{var}","isOnlyVisible":false},"canvas":{"aliases":["FULL_PAGE"],"urlTemplate":"https://community.esri.com/gadgets/canvas?{var}","isOnlyVisible":true},"system-settings":{"isOnlyVisible":true},"about":{"isOnlyVisible":false},"user-prefs":{"isOnlyVisible":true},"embedded":{"isOnlyVisible":true},"home":{"aliases":["HOME"],"urlTemplate":"https://community.esri.com/gadgets/home?{var}","isOnlyVisible":false}}});
window['___jsl']['l'] = (window['___jsl']['l'] || []).concat(['actions','container','core','jive-core-container','open-views','rpc','selection']);