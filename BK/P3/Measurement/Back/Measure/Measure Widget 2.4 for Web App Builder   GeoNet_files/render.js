// This file was automatically generated from render.soy.
// Please don't edit this file by hand.

goog.provide('jive.integration.tiles.view.render');

goog.require('jive.integration.tiles.viewstyle.content');
goog.require('jive.integration.tiles.viewstyle.contentlistnarrow');
goog.require('jive.integration.tiles.viewstyle.sectionlist');
goog.require('jive.integration.tiles.viewstyle.leaderboard');
goog.require('jive.integration.tiles.viewstyle.leaderboardItem');
goog.require('jive.integration.tiles.viewstyle.list_2');
goog.require('jive.integration.tiles.viewstyle.custom_view');
goog.require('jive.integration.tiles.viewstyle.eventList');
goog.require('jive.integration.tiles.viewstyle.slide');
goog.require('jive.integration.tiles.viewstyle.slideList');
goog.require('jive.integration.tiles.viewstyle.lbUlClasses');
goog.require('jive.integration.tiles.viewstyle.listItem_2');
goog.require('jive.integration.tiles.viewstyle.titleAndAuthor');
goog.require('jive.integration.tiles.viewstyle.video');
goog.require('jive.integration.tiles.viewstyle.banner');
goog.require('jive.integration.tiles.viewstyle.userQuestListData');
goog.require('jive.integration.tiles.viewstyle.contentUlClasses');
goog.require('jive.integration.tiles.viewstyle.list');
goog.require('jive.integration.tiles.viewstyle.contentSectionClasses');
goog.require('jive.integration.tiles.viewstyle.carouselbody');
goog.require('jive.integration.tiles.viewstyle.byline');
goog.require('jive.integration.tiles.viewstyle.outcomes');
goog.require('jive.integration.tiles.viewstyle.lbSectionClasses');
goog.require('jive.integration.tiles.viewstyle.socialActions');
goog.require('jive.integration.tiles.viewstyle.quest');
goog.require('jive.integration.tiles.viewstyle.commentControl');
goog.require('jive.integration.tiles.viewstyle.questionResults');
goog.require('jive.integration.tiles.viewstyle.section');
goog.require('jive.integration.tiles.viewstyle.gallery');
goog.require('jive.integration.tiles.viewstyle.bannerImage');
goog.require('jive.integration.tiles.viewstyle.noResults');
goog.require('jive.integration.tiles.viewstyle.calendar');
goog.require('jive.integration.tiles.viewstyle.eventLocation');
goog.require('jive.integration.tiles.viewstyle.rowItem');
goog.require('jive.integration.tiles.viewstyle.galleryImage');
goog.require('jive.integration.tiles.viewstyle.iframe');
goog.require('jive.integration.tiles.viewstyle.contentlistwide');
goog.require('jive.integration.tiles.viewstyle.lbIcon');
goog.require('jive.integration.tiles.viewstyle.contentBody');
goog.require('jive.integration.tiles.viewstyle.ulClasses');
goog.require('jive.integration.tiles.viewstyle.controls');
goog.require('jive.integration.tiles.viewstyle.image_grid');
goog.require('jive.integration.tiles.viewstyle.authorLink');
goog.require('jive.integration.tiles.viewstyle.question');
goog.require('jive.integration.tiles.viewstyle.leaderbordListData');
goog.require('jive.integration.tiles.viewstyle.renderUser');
goog.require('jive.integration.tiles.viewstyle.sectionClasses');
goog.require('jive.integration.tiles.viewstyle.userLink');
goog.require('jive.integration.tiles.viewstyle.contentListItem');
goog.require('jive.integration.tiles.viewstyle.small_quest');
goog.require('jive.integration.tiles.viewstyle.userQuestList');
goog.require('jive.integration.tiles.viewstyle.link');
goog.require('jive.integration.tiles.viewstyle.icon');
goog.require('jive.integration.tiles.viewstyle.hero');
goog.require('jive.integration.tiles.viewstyle.customViewError');
goog.require('jive.integration.tiles.viewstyle.gauge');
goog.require('jive.integration.tiles.viewstyle.listItem');
goog.require('jive.integration.tiles.viewstyle.table');
goog.require('jive.integration.tiles.viewstyle.tileVideoInfo');
goog.require('jive.integration.tiles.viewstyle.carousel');
goog.require('jive.integration.tiles.viewstyle.contentIcon');
goog.require('jive.integration.tiles.viewstyle.header');
goog.require('jive.integration.tiles.viewstyle.eventsStatusList');
goog.require('soy');
goog.require('soydata');
goog.require('soy.StringBuilder');
goog.require('jive.shared.soy.render');


jive.integration.tiles.view.render = function(opt_data, opt_sb) {
  var output = opt_sb || new soy.StringBuilder();
  if (! opt_data.id) {
    jive.shared.soy.render({templateName: 'jive.integration.tiles.viewstyle.' + String(opt_data.viewstyle).toLowerCase(), data: soy.$$augmentMap(opt_data.data, {tileInstanceId: '-1-' + opt_data.definition.id, place: opt_data.place, displayWidth: opt_data.definition.displayWidth, editing: opt_data.editing, columnWidth: opt_data.columnWidth}), failGracefully: true}, output);
  } else {
    jive.shared.soy.render({templateName: 'jive.integration.tiles.viewstyle.' + String(opt_data.viewstyle).toLowerCase(), data: soy.$$augmentMap(opt_data.data, {tileInstanceId: opt_data.id, place: opt_data.place, displayWidth: opt_data.definition.displayWidth, editing: opt_data.editing, columnWidth: opt_data.columnWidth}), failGracefully: true}, output);
  }
  return opt_sb ? '' : output.toString();
};
