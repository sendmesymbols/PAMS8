define(['jquery', 'jive/rtl'], function($, rtl) {
    /**
     * Used by the main video view page to center the player
     * within the dark viewer backdrop. Ignored on other
     * player view profiles.
     */
    function centerElement(element, parent){
        if (element.closest('#j-stream, #j-js-communications').length !==0) return;

        if (element.find('object').length !== 0) {
            var object = element.find('object');
            var newTop = parseInt((parent.height() - object.height()) / 2);
            var newLeft = parseInt((parent.width() - object.width()) / 2);
            if ($('.j-responsive-sm').length > 0) {
                object.css('padding-top', newTop + "px");
                object.css(rtl('padding-left'), newLeft + "px");
            } else {
                element.css('top', newTop + "px");
                element.css(rtl('left'), newLeft + "px");
            }
        } else {
            var newTop = parseInt((parent.height() - element.height()) / 2);
            var newLeft = parseInt((parent.width() - element.width()) / 2);
            element.css('top', newTop + "px");
            element.css(rtl('left'), newLeft + "px");
        }
    }
    
    return centerElement;
});
