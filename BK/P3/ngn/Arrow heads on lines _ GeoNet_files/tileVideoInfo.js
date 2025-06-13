// This file was automatically generated from tileVideoInfo.soy.
// Please don't edit this file by hand.

goog.provide('jive.integration.tiles.viewstyle.tileVideoInfo');

goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.shared.soy.resourceInlineJs');


jive.integration.tiles.viewstyle.tileVideoInfo = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  output.append('<div class="j-stream-comms-video-info clearfix">');
  jive.shared.soy.resourceInlineJs({code: 'require([ \'jquery\', \'plugins/video/resources/script/getVideoThumbnailAndRenderer\', \'plugins/video/resources/script/getVideoDataAndRender\' ], function($, getVideoThumbnailAndRender, getVideoDataAndRender) {getVideoThumbnailAndRender(\'video-tile-link-' + soy.$$escapeHtml(opt_data.video.videoID) + '\', ' + soy.$$escapeHtml(opt_data.video.videoID) + ', ' + soy.$$escapeHtml(opt_data.video.objectType) + ', ' + soy.$$escapeHtml(opt_data.video.videoID) + ', 328, 250, true); $(\'#video-tile-link-' + soy.$$escapeHtml(opt_data.video.videoID) + '\').click(function(e) {var $this = $(this); require([\'jive/accessibility\'], function(Accessibility) {Accessibility.pushFocus($this);}); getVideoDataAndRender(\'video-tile-link-' + soy.$$escapeHtml(opt_data.video.videoID) + '\', ' + soy.$$escapeHtml(opt_data.video.videoID) + ', ' + soy.$$escapeHtml(opt_data.video.objectType) + ', ' + soy.$$escapeHtml(opt_data.video.videoID) + ', 328, 250, true); e.preventDefault();});});'}, output);
  output.append('<a href="#" class="j-tile-video-thumb" id="video-tile-link-', soy.$$escapeHtmlAttribute(opt_data.video.videoID), '"><img src="', soy.$$escapeHtmlAttribute(soy.$$filterNormalizeUri(opt_data.video.previewImageURL)), '/328" width="100%" title="', soy.$$escapeHtmlAttribute(jive.i18n.i18nText(jive.i18n.getMsg('pa61'),[])), '" alt="', soy.$$escapeHtmlAttribute(jive.i18n.i18nText(jive.i18n.getMsg('pa61'),[])), '"/></a></div>');
  return opt_sb ? '' : output.toString();
};
