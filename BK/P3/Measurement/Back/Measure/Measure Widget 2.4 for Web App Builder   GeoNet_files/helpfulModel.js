define(['jquery', 'apps/shared/models/core_deferred'], function($, core) {

    function createHelpful(ed) {
        return getObject(ed).then(function(obj) {
            if (obj.markHelpful) {
                return core.runQuery(obj.markHelpful());
            }
        });
    }

    function destroyHelpful(ed) {
        return getObject(ed).then(function(obj) {
            if (obj.unmarkHelpful) {
                return core.runQuery(obj.unmarkHelpful());
            }
        });
    }

    function createUnhelpful(ed) {
        return getObject(ed).then(function(obj) {
            if (obj.markUnhelpful) {
                return core.runQuery(obj.markUnhelpful());
            }
        });
    }

    function destroyUnhelpful(ed) {
        return getObject(ed).then(function(obj) {
            if (obj.unmarkUnhelpful) {
                return core.runQuery(obj.unmarkUnhelpful());
            }
        });
    }

    function getObject(ed) {
        return core.getObject(ed.type, ed.id);
    }

    return {
        createHelpful: createHelpful,
        destroyHelpful: destroyHelpful,
        createUnhelpful: createUnhelpful,
        destroyUnhelpful: destroyUnhelpful
    };
});
