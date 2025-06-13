var piAId;

var piCId;

var digitalData;

(function($) {
    var urls = {
        pardot: {
            http: "http://cdn.pardot.com/pd.js",
            https: "https://pi.pardot.com/pd.js"
        },
        adobe: {
            prd: "//assets.adobedtm.com/2e9cd01e19dc5ac4867e752f17a2f1ea1923e5af/satelliteLib-0ed1001fd441a838aefe8e755be42aaafddcc46b.js",
            stg: "//assets.adobedtm.com/2e9cd01e19dc5ac4867e752f17a2f1ea1923e5af/satelliteLib-0ed1001fd441a838aefe8e755be42aaafddcc46b-staging.js"
        },
        domainService: document.location.protocol + "//webnode.esri.com/3012/rest/pardot/domain"
    };
    function initPardot(domain) {
        if (!domain) {
            domain = {
                piAId: 83202,
                piCId: 4012,
                adobe_scripts: []
            };
        }
        piAId = domain.piAId;
        piCId = domain.piCId;
        if (document.location.protocol == "https:") {
            writeScriptTag(urls.pardot.https);
        } else {
            writeScriptTag(urls.pardot.http);
        }
    }
    function initAdobeTracking(domain) {
        if (domain && domain.adobe_scripts && domain.adobe_scripts.length > 0) {
            var isPrd = domain.adobe_scripts.indexOf("prd") > -1;
            if (isPrd) {
                writeScriptTag(urls.adobe.prd);
            } else {
                writeScriptTag(urls.adobe.stg);
            }
            var _adtmsat = document.createElement("script");
            _adtmsat.id = "_adtmsat";
            _adtmsat.text = "_satellite.pageBottom();";
        }
    }
    function setupDigitalData() {
        digitalData = {
            timestamp: new Date()
        };
        var pathArray = window.location.pathname.split("/");
        digitalData.pageInfo = {
            pageName: document.title,
            siteSection1: window.location.host,
            siteSection2: pathArray.length > 1 ? pathArray[1] : "",
            siteSection3: pathArray.length > 2 ? pathArray[2] : "",
            siteSection4: pathArray.length > 3 ? pathArray[3] : "",
            url: window.location.href
        };
        digitalData.language = {
            current: navigator.language,
            acceptedLanguages: navigator.languages
        };
        digitalData.referrer = document.referrer;
        digitalData.scroll = window.scrollY;
        $(window).scroll(function(event) {
            digitalData.scroll = window.scrollY;
        });
        digitalData.meta = {};
        var metas = document.getElementsByTagName("meta");
        for (i = 0; i < metas.length; i++) {
            var metaName = metas[i].getAttribute("name");
            if (stringStartsWith(metaName, "esri-")) {
                digitalData.meta[metaName.substring(5)] = metas[i].getAttribute("content");
            }
        }
    }
    function writeScriptTag(scriptUrl) {
        var scriptTag = document.createElement("script");
        scriptTag.type = "text/javascript";
        scriptTag.src = scriptUrl;
        var c = document.getElementsByTagName("script")[0];
        c.parentNode.insertBefore(scriptTag, c);
    }
    function stringStartsWith(string, prefix) {
        if (string) {
            return string.slice(0, prefix.length) == prefix;
        }
    }
    (function runIt() {
        var domainsResponse = $.ajax({
            type: "get",
            url: urls.domainService,
            async: false
        }).responseText;
        var domains = JSON.parse(domainsResponse);
        var domain = domains.filter(function(entry) {
            return entry.name.toLowerCase() == window.location.host;
        })[0];
        initPardot(domain);
        initAdobeTracking(domain);
        setupDigitalData();
    })();
})(jQuery);