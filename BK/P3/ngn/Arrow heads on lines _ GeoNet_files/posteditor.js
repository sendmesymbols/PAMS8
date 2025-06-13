define([
    'jquery'
], function($) {
    // timeout for dwr calls
    var DWRTimeout = 20000;
    var objectLookupSessionKey;
    var errorHandlerMessage = 'An error occurred:';
    var __postSubmitted = false;
    var cancelPost = false;

    /*
     * This function will not return until (at least)
     * the specified number of milliseconds have passed.
     * It uses a modal dialog for IE, busy loop for ff
     */
    this.pause = function(numberMillis) {
        if (window.showModalDialog) {
            var dialogScript =
                'window.setTimeout(' +
                ' function () { window.close(); }, ' + numberMillis + ');';
            var result =
                window.showModalDialog(
                    'javascript:document.writeln(' +
                    '"<script>' + dialogScript + '<' + '/script>")');
        } else {
            var now = new Date();
            var exitTime = now.getTime() + numberMillis;
            while (true) {
                now = new Date();
                if (now.getTime() > exitTime)
                    return;
            }
        }
    };


    this.getEditorMode = function() {
        return currentMode;
    };


    this.editorErrorHandler = function(message, exception) {
        // if the message is something other than a timeout, show the message plus the error code
        if (message.indexOf('Timeout') == -1) {
            $('#dwr-error-text').text(errorHandlerMessage + ' Error Code: ' + message);
            $('#dwr-error-table').fadeIn();
            setTimeout(function() {
                $('#dwr-error-table').fadeOut();
            }, 10000);
        }
    };

    this.validatePost = function(isSubmit, ignoreBody, editorId, form) {
        if (cancelPost) {
            return true;
        }
        if (typeof(editorId) == 'undefined') editorId = 'wysiwygtext';
        var hasError = false;

        var rte = window.editor.get(editorId);
        var $form = $(form) || $(document);

        // verify that a subject and body have been provided
        var sub = $form.find('#subject01').get(0);
        if (typeof(sub) != 'undefined' && $.trim(sub.value) == '') {
            // display alert
            var t = $form.find('#post-error-table').get(0);
            if (t) {
                t.style.display = 'block';
                scroll(0, 0);
                t = $form.find('#post-error-subject').get(0);
                if (t) {
                    t.style.display = 'block';
                    scroll(0, 0);
                }
            }
            hasError = true;
        } else {
            var t = $form.find('#post-error-subject').get(0);
            if (t) {
                t.style.display = 'none';
            }
        }

        var body;
        if (!rte.isMobileOnly()) {
            // this forces the RTE to
            // filter+cleanup the content
            //        rte.setHTML(rte.getHTML());
            body = rte.getHTML();

            // safari 1.x and 2.x bug: http://lists.apple.com/archives/Web-dev/2005/Feb/msg00106.html
            if (rte.isTextOnly()) {
                rte.getTextArea().style.display = 'inline';
                rte.innerHTML = '';
                rte.appendChild(document.createTextNode(body));
                rte.style.display = 'none';
            }
        } else {
            body = rte.getHTML();
        }

        rte.getOriginalTextBox().val(body);

        if (!ignoreBody && (body == null || $.trim(body) == '')) {
            // display alert
            var t = $form.find('#post-error-table').get(0);
            if (t) {
                t.style.display = 'block';
                scroll(0, 0);
                t = $form.find('#post-error-body').get(0);
                if (t) {
                    t.style.display = 'block';
                    scroll(0, 0);
                }
            }
            hasError = true;
        } else {
            // put the body of the gui editor into the text area
            var legacyBody = $form.find('#textEditor').get(0);
            if (legacyBody) {
                //We need this for backward compatibility; see CS-23883
                legacyBody.value = body;
            }
            // flag as coming from the gui editor so that we know to unformat it
            $form.find('#postTypeFlag').get(0).value = 'true';
            var t = $form.find('#post-error-body').get(0);
            if (t) {
                t.style.display = 'none';
            }
        }

        if (hasError) {
            return false;
        }

        // hide alert
        var t = $form.find('#post-error-table').get(0);
        if (t) {
            t.style.display = 'none';
        }

        if (arguments.length > 0) {
            window.onbeforeunload = null;
        }

        if (!__postSubmitted && isSubmit) {
            __postSubmitted = true;
            return true;
        } else if (!isSubmit) {
            return true;
        }
        return false;
    };
});
