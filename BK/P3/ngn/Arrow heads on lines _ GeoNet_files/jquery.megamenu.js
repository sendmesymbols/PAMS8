/*
*  jQuery Mega Menu with Responsive Components
*
*            Last Edited: CH 4.30.15
*/

var is_touch_device = 'ontouchstart' in document.documentElement;

function esriMegaMenu(mmOptions, thiss) {
    var defaults = {
        esriMegaMenu: true,

        // Mega Menu
        megaMenuID: '#mega-menu',
        megaMenuSub: '.menu-slide',
        megaMenuActive: 'active',

        // Mega Menu Speed of Open and Close
        speedOpen: 'slow',
        speedClose: 'slow',

        // Search
        searchBtn: '#submit',
        searchBtnActive: 'search-active',
        searchInput: '#mast',

        // Responsive Menu
        // Global navigation menu button ID
        menuID: 'global-menu',
        // Global search button ID
        searchID: 'global-search',
        // Responsive Search
        searchToggle: 'header-search',
        // Global nav active class
        menuClassActive: 'minus',
        // Responsive Menu - Sub Navigation
        parentActive: 'mobile-on',
        // global search active class
        searchClassActive: 'mobile-search-active',
        // Menu to toggle
        menuToggle: 'nav'
    };

    mmOptions = jQuery.extend(defaults, mmOptions);

    return thiss.each(function() {
       //hack to fix megamenu menu-slide in older templates.

    var o = mmOptions;
        var obj = jQuery(this);

        // Mega Menu show / hide
        jQuery('#nav a').click( function() {

            var navID = jQuery(this).attr('data-name');
            var item = '#' + navID;
            var navItem = item+'-nav';
            var active = o.megaMenuActive;

            var megaMenuCont = jQuery(o.megaMenuID),
            megaMenuSlide = jQuery(o.megaMenuSub);

            // Fire the proper events
            if (navID && !jQuery(item).hasClass(active)) {
                showMenu();
            } else if (megaMenuSlide.hasClass(active)) {
                hideMenu();
            } else {
                hideMenu();
            }

            // Show Menu and Hide Children
            function showMenu() {

                if (megaMenuSlide.hasClass(active)) {
                    // If a menu is visible
                    // Hide active menu remove previous
                    megaMenuSlide.removeClass(active);
                    jQuery(item).css('opacity','0').addClass(active).animate({
                        opacity:'1'
                    });
                    // change
                    jQuery('#buildMegaMenu #nav li').removeClass(active);
                    jQuery(navItem).addClass(active);

                } else {
                    // If no menu shown activate normally
                    jQuery(navItem).addClass(active);
                    jQuery(o.megaMenuID)/* .css('height','0px') */.animate({
                        height:'425px'
                    });
                    jQuery(item).css('opacity','0').addClass(active).animate({
                        opacity:'1'
                    });
                //jQuery(item).css('height','0px').addClass(active).animate({height:'100%'});

                }
            }

            // Hide Menu
            function hideMenu() {
                jQuery(item).animate({
                    opacity:'0'
                });
                jQuery(o.megaMenuID).animate({
                    height:'0px'
                });
                // updated 7.23.14 jh - for sitecore bug
                jQuery('#header-nav #nav li').removeClass(active);
                setTimeout(function(){
                    jQuery(item).removeClass(active);
                },500);
            }

        });


        // -------------------------------------------
        // Responsive Mega Menu Component
        // -------------------------------------------

        // HTML for Global Menu Button
        // var menuBtnStructure = '<span id="'+ o.menuID +'">Menu<span class="icon"></span></span>';
        // // HTML for Global search button
        // var searchBtnStructure = '<span id="'+ o.searchID +'"></span>';
        // Injects elements for mobile
        //jQuery(obj).prepend(searchBtnStructure + menuBtnStructure);
        jQuery('#global-search,#global-menu').remove();
        jQuery(obj).prepend(renderMenu());

        //RENDER FUNCTION
        function renderMenu(){
            var menuBtnStructure = '<span id="'+ o.menuID +'">Menu<span class="icon"></span></span>';
            // HTML for Global search button
            var searchBtnStructure = '<span id="'+ o.searchID +'"></span>';
            return '<div id="megaMenuMobile">'+searchBtnStructure + menuBtnStructure+'</div>';
        }

        if (o.esriMegaMenu == "true"){
            jQuery('ul', o.megaMenuID).hide();
            // add mobile button to page
            //jQuery(obj).prepend(subBtnStructure);
            jQuery(o.megaMenuID).children('ul').attr('id','mega-menu');

            // Find all elements with children and add sub menu button
            jQuery('li > ul', obj).parent().addClass(o.subDropDown).prepend(subDropStructure);
        //jQuery(o.megaMenuSub +' ul').addClass(o.megaSubMenu);
        }

        // Global Esri Navigation
        function closeMenuItems() {
            // Remove active class from search box
            //jQuery('#'+o.searchToggle).hide();
            jQuery(obj).removeClass(o.searchClassActive);

            // Hides all inner navigation
            jQuery(o.megaMenuSub +'.'+ o.megaMenuActive).removeClass(o.megaMenuActive);
            jQuery('ul.'+ o.megaMenuActive +'-sub').removeClass(o.megaMenuActive + '-sub');
        }

        // Opens main items for Mega Menu
        //  var menuheight = jQuery(o.megaMenuID).height();
        var menucontainer = jQuery(o.megaMenuID);

        jQuery('#global-menu').click(function(e) {
            e.preventDefault();

            if (!jQuery(o.megaMenuID).hasClass('mobile-on')) {

                jQuery(this).addClass('active');

                jQuery(o.megaMenuID).css('height','auto').addClass(o.parentActive);
                // REMOVING GREENSOCK
                // mobileTween.play();

                closeMenuItems();

            } else if (jQuery(o.megaMenuID).hasClass('mobile-on')) {

                jQuery(this).removeClass('active');
                // REMOVING GREENSOCK
                //mobileTween.reverse();

                setTimeout(function(){
                    jQuery(o.megaMenuID).removeClass(o.parentActive);
                },200);

                closeMenuItems();

            }
        });

        // Toggles Main Nav Items (Secondary)
        var openItem = jQuery(".wrapper-nav"); //,

        jQuery('.menu-nav').click( function() {
            var parentElement = jQuery(this).parent();

            if (!parentElement.hasClass('active')) {
              parentElement.siblings().removeClass('active');
              parentElement.addClass('active');

            } else {
              parentElement.removeClass('active');
            }

        });


        // Toggles Sub Navigation Items (Tertiary)
        jQuery('.menu-sub-nav').click( function() {

            // If parent is not active make it active and hide all others
            if (!jQuery(this).parent().hasClass(o.megaMenuActive + '-sub')) {
                jQuery('ul.'+ o.megaMenuActive +'-sub').removeClass(o.megaMenuActive + '-sub');
                jQuery(this).parent().addClass(o.megaMenuActive + '-sub');
            }

            // If parent is active remove active class
            else if (jQuery(this).parent().hasClass(o.megaMenuActive + '-sub')) {
                jQuery(this).parent().removeClass(o.megaMenuActive + '-sub');
            }
        });



        // Global Esri Search
        jQuery('#'+ o.searchID).click(function(){
          console.log('search activated');
          //jQuery('#' + o.searchToggle).toggle();
          jQuery(o.searchInput).show().focus();
          jQuery(obj).toggleClass(o.searchClassActive);

          //Remove Global nav
          jQuery(o.megaMenuID).removeClass(o.parentActive);
          jQuery('#'+ o.menuID).removeClass(o.megaMenuActive);
        });


        // Style resets in case browser window is adjusted
        function adjustStyle(width) {
            width = parseInt(width);
            if (width < 760) {
                // Global
                //jQuery('#' + o.menuToggle).hide();

                jQuery(o.megaMenuID).css('height','0px').removeClass(o.parentActive);
                //jQuery('#' + o.searchToggle).hide().find(o.searchInput).hide();
                jQuery('#' + o.menuID).removeClass(o.menuClassActive);

                // Hide all mega menu children
                jQuery(o.megaMenuSub +'.' + o.megaMenuActive).removeClass(o.megaMenuActive);
                jQuery('ul.'+ o.megaMenuActive +'-sub').removeClass(o.megaMenuActive + '-sub');

                jQuery(obj).removeClass(o.searchClassActive);

                jQuery('#nav li').removeClass('active');
                jQuery('#global-menu').removeClass('active');
                jQuery(o.megaMenuSub).css('opacity','1');
            }
            else {
                // Global
                jQuery('#' + o.menuToggle).show();
                jQuery('#' + o.searchToggle).show();

                jQuery('#global-menu').removeClass('active');

                //jQuery('#nav li').removeClass('active');
                jQuery(o.megaMenuSub).css('opacity','1');
            }
        }

        // Executes the screen size check
        jQuery(function() {
            var width = jQuery(window).width();
            adjustStyle(jQuery(this).width());
            jQuery(window).resize(function() {
                if(jQuery(this).width() != width){
                    adjustStyle(jQuery(this).width());
                    width = jQuery(this).width();
                }
            });
        });
    // End of resize window function


    });

}
//End of Esri Mega Menu

 if(typeof MegaMenuLogin != 'undefined'){
   var __mml = new MegaMenuLogin({tier:tier});
   var jivelinks = ["community.esri.com","community-qa.esri.com","geonet.esri.com"];
   if(jivelinks.indexOf(location.hostname) != -1 && __mml.user.token){

         if(jQuery('#navLogin').length){
             window.location ="/login.jspa?ssologin=true&fragment=&";
             //return;
         }

         else {
      //jQuery('#navLogin').hide();//hide login button
      jQuery('.ec_home_signup_box').parent().hide().siblings(".grid-75").addClass("grid-100").removeClass("grid-75");//hide join button,expand welcome div
      //jQuery('.ec_home_signup_box').parent().hide(); //hide join button
       logit('logging into jive');
     }
   }
 }
jQuery(document).ready(function(){
    if(is_touch_device) {
      document.body.className+=' touch-enabled';
    } else {
    //document.body.className+=' non-touch-enabled';
    //}
}

if(typeof MegaMenuLogin != 'undefined'){
  jQuery('#header-search').before(__mml.render());
  //jQuery('#utility-nav .utility-nav-container').before(__mml.render());
}


  var calloutLinks = {
    'products':[-1,-2],
    'industries':[-1,-2]

  }

  for(var l in calloutLinks){
    var sid = calloutLinks[l];
    sid.map(function(lid){
      jQuery('ul#'+sid).find('a').eq(lid).html('<h2>'+jQuery('ul#'+sid).find('a').eq(lid).html()+'</h2>');
    })
  }
    //jQuery('#header,#mmHeader').esriMegaMenu();
    esriMegaMenu({}, jQuery('#header, #mmHeader'));
    jQuery(document).click(function(ebt) {
        var nonclosers = ['mega-menu','mmHeader','header'];
        //is a closer
        if(nonclosers.indexOf(ebt.target.id) == -1 //not a non-closer itself
            //not the child of a non-closer
            && !jQuery(ebt.target).parents('#mmHeader').length
            && !jQuery(ebt.target).parents('#header').length
            ){
            //close menu
           jQuery(".treeview, #header, #mmHeader").find(".active a").click()
        }

    });

    if($GET('emm')){
        var section = $GET('emm');
        $('#'+section+'-nav a').click()
    }
});
