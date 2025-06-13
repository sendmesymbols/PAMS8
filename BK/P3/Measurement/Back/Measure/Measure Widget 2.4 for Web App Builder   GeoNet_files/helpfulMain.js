define([
    './helpfulModel',
    'apps/shared/controllers/localexchange',
    'application/base_view',
    'channel!outcomes'
], function(helpfulModel, localexchange, View, outcomesChannel) {

    function createHelpful(ed) {
        return helpfulModel.createHelpful(ed).done(function() {
            //We've effectively removed the old outcome.  Emit the appropriate events.
            localexchange.emit('outcome.helpfulCreated', ed);
            outcomesChannel.trigger('outcomes.refreshContentRegion');
        });
    }

    function destroyHelpful(ed) {
        return helpfulModel.destroyHelpful(ed).done(function() {
            //We've effectively removed the old outcome.  Emit the appropriate events.
            localexchange.emit('outcome.helpfulDeleted', ed);
            outcomesChannel.trigger('outcomes.refreshContentRegion');
        });
    }


    function createUnhelpful(ed) {
        return helpfulModel.createUnhelpful(ed).done(function() {
            //We've effectively removed the old outcome.  Emit the appropriate events.
            localexchange.emit('outcome.unhelpfulCreated', ed);
            outcomesChannel.trigger('outcomes.refreshContentRegion');
        });
    }

    function destroyUnhelpful(ed) {
        return helpfulModel.destroyUnhelpful(ed).done(function() {
            //We've effectively removed the old outcome.  Emit the appropriate events.
            localexchange.emit('outcome.unhelpfulDeleted', ed);
            outcomesChannel.trigger('outcomes.refreshContentRegion');
        });
    }

    localexchange.addListener('outcome.createHelpful', createHelpful);
    localexchange.addListener('outcome.deleteHelpful', destroyHelpful);
    localexchange.addListener('outcome.createUnhelpful', createUnhelpful);
    localexchange.addListener('outcome.deleteUnhelpful', destroyUnhelpful);

    return {
        createHelpful: createHelpful,
        destroyHelpful: destroyHelpful,
        createUnhelpful: createUnhelpful,
        destroyUnhelpful: destroyUnhelpful
    };
});
