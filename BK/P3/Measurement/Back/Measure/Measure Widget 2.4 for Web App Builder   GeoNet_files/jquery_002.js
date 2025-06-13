;
(function ($) {
  function fancyBoxInit() {

    if (typeof $.fn.fancybox == 'undefined') {
      return;
    }

    $('[class*="colorbox-"]').click(function (e) {
      e.preventDefault();
    });

    $(".colorbox-image").fancybox();

    $(".colorbox-ajax").addClass('fancybox.ajax').fancybox({
      maxWidth: 800,
      maxHeight: 600,
      fitToView: false,
      width: '70%',
      height: '70%',
      autoSize: false,
      closeClick: false,
      openEffect: 'none',
      closeEffect: 'none'
    });

    // iframes and content
    $('.colorbox-content').addClass('fancybox.iframe').fancybox({
      maxWidth: "90%",
      maxHeight: "90%",
      openEffect: 'none',
      closeEffect: 'none'
    });
    $('.colorbox-inline').addClass('fancybox.iframe').fancybox({
      maxWidth: "90%",
      maxHeight: "90%",
      openEffect: 'none',
      closeEffect: 'none'
    });
    $('.colorbox-iframe').addClass('fancybox.iframe').fancybox({
      maxWidth: "90%",
      maxHeight: "90%",
      openEffect: 'none',
      closeEffect: 'none'
    });
    $('.colorbox-iframe-auto').addClass('fancybox.iframe').fancybox({
      maxWidth: "90%",
      maxHeight: "90%",
      openEffect: 'none',
      closeEffect: 'none'
    });

    //For MP3 files
    $(".colorbox-audio").addClass('fancybox.iframe').fancybox({
      maxWidth: 480,
      maxHeight: 150,
      openEffect: 'none',
      closeEffect: 'none'
    });

    $(".colorbox-videoauto").addClass('fancybox.iframe').fancybox({
      maxWidth: 800,
      maxHeight: 600,
      openEffect: 'none',
      closeEffect: 'none'
    });
    $(".colorbox-videoauto2").addClass('fancybox.iframe').fancybox({
      maxWidth: "90%",
      maxHeight: "90%",
      openEffect: 'none',
      closeEffect: 'none'
    });
    $(".colorbox-video").addClass('fancybox.iframe').fancybox({
      maxWidth: 800,
      maxHeight: 600,
      fitToView: false,
      width: '70%',
      height: '70%',
      autoSize: false,
      closeClick: false,
      openEffect: 'none',
      closeEffect: 'none'
    });

    // FOR ESRI VIDEO
    $('.colorbox-evsmall').addClass('fancybox.iframe').fancybox({
      openEffect: 'none',
      closeEffect: 'none',
      maxWidth: 480,
      maxHeight: 274,
      helpers: {
        title: { type: 'inside' },
        media: {}
      }
    });

    $('.colorbox-evmedium').addClass('fancybox.iframe').fancybox({
      openEffect: 'none',
      closeEffect: 'none',
      maxWidth: 720,
      maxHeight: 409,
      helpers: {
        title: { type: 'inside' },
        media: {}
      }
    });

    $('.colorbox-evlarge').addClass('fancybox.iframe').fancybox({
      openEffect: 'none',
      closeEffect: 'none',
      width: 960,
      maxHeight: 544,
      helpers: {
        title: { type: 'inside' },
        media: {}
      }
    });

    $('.colorbox-ex-evsmall').addClass('fancybox.iframe').fancybox({
      openEffect: 'none',
      closeEffect: 'none',
      helpers: {
        title: { type: 'inside' },
        media: {}
      }
    });

    $('.colorbox-evauto').addClass('fancybox.iframe').fancybox({
      openEffect: 'none',
      closeEffect: 'none',
      width: "auto",
      maxHeight: "auto",
      helpers: {
        title: { type: 'inside' },
        media: {}
      }
    });

    var pardot_width = '90%',
        pardot_height = '90%',
        client_width = window.self.innerWidth,
        pardot_els = $(".pardot-fancybox");

    if (pardot_els.length > 0) {
      if (client_width > 600) {
        pardot_width = $(pardot_els[0]).data('width') || pardot_width;
        pardot_height = $(pardot_els[0]).data('height') || pardot_height;
      } else {
        pardot_width = $(pardot_els[0]).data('mobile-width') || pardot_width;
        pardot_height = $(pardot_els[0]).data('mobile-height') || pardot_height;
      }
    }

    $(".pardot-fancybox").fancybox({
      'width': pardot_width,
      'height': pardot_height,
      'autoScale': false,
      'transitionIn': 'none',
      'transitionOut': 'none',
      'type': 'iframe'
    });
    $('.pardot-fancybox').click(function (e) {
      e.preventDefault();
    });
  }

  // Initalize
  $(document).ready(function () {
    fancyBoxInit();
  });
})(jQuery);
//# sourceMappingURL=jquery.fancybox.init.js.map
