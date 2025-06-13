jQuery.noConflict(), jQuery(document).ready(function() {
    function a(a) {
        jQuery(".trigger").removeClass("deactivecard"), jQuery(".toggle:visible").not(a).hide(), a.slideToggle("slow")
    }
    jQuery(".trigger").click(function() {
        var b = jQuery(jQuery(this).find("a").attr("href"));
        jQuery(this).hasClass("activecard") ? (a(b), jQuery(this).removeClass("activecard")) : (a(b), jQuery.each(jQuery(".geonet-card"), function() {
            jQuery(this).addClass("deactivecard").removeClass("activecard")
        }), jQuery(this).removeClass("deactivecard").addClass("activecard"))
    })
});

jQuery(window).load(function() {
    var cookie = getCookieByName('esri_auth');
    if(cookie){
        var login = document.getElementById('navLogin');

        if(login){
            login.click();
        }
        else{
            jQuery('.ec_home_signup_box').hide();
        }
    }
});

function getCookieByName(name){
    var ret = false;
    var cookies = document.cookie.split(';');
    cookies.forEach(function(cookie){
        var cookieParts = cookie.split('=');
        if(cookieParts[0].trim() == name){
            var decoded = unescape(cookieParts[1]);
            ret = JSON.parse(decoded);
        }
    });
    return ret;
}