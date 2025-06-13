/**
 * Helpful links and counts view
 */
define([
    'jquery',
    'underscore',
    'apps/shared/controllers/localexchange',
    './viewUtil',
    './helpfulMain',
    'soy!jive.outcomes.helpful.displayHelpfulCounts'
], function($, _, localexchange, viewUtil) {

    function clickHandler(ev) {
        var $link = $(this);
        if ($link.attr('data-command') === 'mark') {
            mark($link);
        } else {
            unmark($link);
        }
    }

    function mark($link) {
        if ($link.attr('data-type') === 'helpful') {
            markHelpful($link);
        } else {
            markUnhelpful($link);
        }
    }

    function unmark($link) {
        if ($link.attr('data-type') === 'helpful') {
            unmarkHelpful($link);
        } else {
            unmarkUnhelpful($link);
        }
    }

    function markHelpful($helpful) {
        var $linkContainer = $helpful.parent('.js-outcome-helpful-container'),
            ed = viewUtil.getEd($linkContainer),
            $unhelpful = $linkContainer.find('.js-unhelpful-link'),
            isUnhelpful = $unhelpful.hasClass('js-selected');

        localexchange.emit('outcome.createHelpful', ed);

        $linkContainer.find('.js-icon-helpful').addClass('active');
        $unhelpful.removeClass('js-selected').removeClass('j-selected');
        $helpful.addClass('js-selected').addClass('j-selected');
        $unhelpful.attr('data-command', 'mark');
        $helpful.attr('data-command', 'unmark');

        if (isUnhelpful) {
            incrementHelpful(ed);
        } else {
            incrementBoth(ed);
        }
    }

    function unmarkHelpful($helpful) {
        var $linkContainer = $helpful.parent('.js-outcome-helpful-container'),
            ed = viewUtil.getEd($linkContainer),
            $unhelpful = $linkContainer.find('.js-unhelpful-link');

        localexchange.emit('outcome.deleteHelpful', ed);

        $linkContainer.find('.js-selected').removeClass('js-selected').removeClass('j-selected');
        $linkContainer.find('.js-icon-helpful').removeClass('active');
        $helpful.attr('data-command', 'mark');
        $unhelpful.attr('data-command', 'mark');

        decrementBoth(ed);
    }

    function markUnhelpful($unhelpful) {
        var $linkContainer = $unhelpful.parent('.js-outcome-helpful-container'),
            ed = viewUtil.getEd($linkContainer),
            $helpful = $linkContainer.find('.js-helpful-link'),
            isHelpful = $helpful.hasClass('js-selected');

        localexchange.emit('outcome.createUnhelpful', ed);

        $linkContainer.find('.js-selected').removeClass('js-selected').removeClass('j-selected');
        $linkContainer.find('.js-icon-helpful').removeClass('active');
        $unhelpful.addClass('js-selected').addClass('j-selected');
        $unhelpful.attr('data-command', 'unmark');
        $helpful.attr('data-command', 'mark');

        if (isHelpful) {
            decrementHelpful(ed);
        } else {
            incrementOverall(ed);
        }
    }

    function unmarkUnhelpful($unhelpful) {
        var $linkContainer = $unhelpful.parent('.js-outcome-helpful-container'),
            ed = viewUtil.getEd($linkContainer),
            $helpful = $linkContainer.find('.js-helpful-link');

        localexchange.emit('outcome.deleteUnhelpful', ed);

        $linkContainer.find('.js-selected').removeClass('js-selected').removeClass('j-selected');
        $linkContainer.find('.js-icon-helpful').removeClass('active');
        $unhelpful.attr('data-command', 'mark');
        $helpful.attr('data-command', 'mark');

        decrementOverall(ed);
    }

    function incrementHelpful(ed) {
        adjustCounts(1, 0, ed);
    }

    function incrementOverall(ed) {
        adjustCounts(0, 1, ed);
    }

    function incrementBoth(ed) {
        adjustCounts(1, 1, ed);
    }

    function decrementHelpful(ed) {
        adjustCounts(-1, 0, ed);
    }

    function decrementOverall(ed) {
        adjustCounts(0, -1, ed);
    }

    function decrementBoth(ed) {
        adjustCounts(-1, -1, ed);
    }

    function adjustCounts(helpful, overall, ed) {
        var $countsContainer = getCountsContainer(ed),
            data = $countsContainer.data();

        if ($countsContainer.length) {
            data = _.extend(data, getCountsAndUpdate($countsContainer, helpful, overall));
            var updatedCounts = jive.outcomes.helpful.displayHelpfulCounts(data);

            $countsContainer.replaceWith(updatedCounts);
        }
    }

    function getCountsContainer(ed) {
        return $('.js-outcome-helpful-counts-container' + '[data-object-type="' + ed.type + '"]' + '[data-object-id="' + ed.id + '"]');
    }

    function getCountsAndUpdate($ele, helpful, overall) {
        return {
            helpfulCount: $ele.data('helpfulCount') + helpful,
            overallCount: $ele.data('overallCount') + overall
        };
    }

    return {
        clickHandler: clickHandler,
        unmarkUnhelpful: unmarkHelpful,
        markHelpful: markHelpful
    };
});
