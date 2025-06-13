require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n({
        en:{
            common:{
                edit_confirm:"Do you want to use the WYSIWYG mode for this textarea?",
                apply:"Apply",
                insert:"Insert",
                update:"Update",
                cancel:"Cancel",
                close:"Close",
                browse:"Browse",
                class_name:"Class",
                not_set:"-- Not set --",
                clipboard_msg:"Copy/Cut/Paste is not available in Mozilla and Firefox.\nDo you want more information about this issue?",
                clipboard_no_support:"Currently not supported by your browser, use keyboard shortcuts instead.",
                popup_blocked:"Sorry, but we have noticed that your popup-blocker has disabled a window that provides application functionality. You will need to disable popup blocking on this site in order to fully utilize this tool.",
                invalid_data:"Error: Invalid values entered, these are marked in red.",
                more_colors:"More colors"
            },
            contextmenu:{
                align:"Alignment",
                left:"Left",
                center:"Center",
                right:"Right",
                full:"Full"
            },
            insertdatetime:{
                date_fmt:"%Y-%m-%d",
                time_fmt:"%H:%M:%S",
                insertdate_desc:"Insert date",
                inserttime_desc:"Insert time",
                months_long:"January,February,March,April,May,June,July,August,September,October,November,December",
                months_short:"Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec",
                day_long:"Sunday,Monday,Tuesday,Wednesday,Thursday,Friday,Saturday,Sunday",
                day_short:"Sun,Mon,Tue,Wed,Thu,Fri,Sat,Sun"
            },
            print:{
                print_desc:"Print"
            },
            preview:{
                preview_desc:"Preview"
            },
            directionality:{
                ltr_desc:"Direction left to right",
                rtl_desc:"Direction right to left"
            },
            layer:{
                insertlayer_desc:"Insert new layer",
                forward_desc:"Move forward",
                backward_desc:"Move backward",
                absolute_desc:"Toggle absolute positioning",
                content:"New layer..."
            },
            save:{
                save_desc:"Save",
                cancel_desc:"Cancel all changes"
            },
            nonbreaking:{
                nonbreaking_desc:"Insert non-breaking space character"
            },
            advhr:{
                advhr_desc:"Horizontal rule"
            },
            emotions:{
                emotions_desc:"Emotions"
            },
            searchreplace:{
                search_desc:"Find",
                replace_desc:"Find/Replace"
            },
            advimage:{
                image_desc:"Insert/edit image"
            },
            advlink:{
                link_desc:"Insert/edit link"
            },
            xhtmlxtras:{
                cite_desc:"Citation",
                abbr_desc:"Abbreviation",
                acronym_desc:"Acronym",
                del_desc:"Deletion",
                ins_desc:"Insertion",
                attribs_desc:"Insert/Edit Attributes"
            },
            style:{
                desc:"Edit CSS Style"
            },
            paste:{
                paste_text_desc:"Paste as Plain Text",
                paste_word_desc:"Paste from Word",
                selectall_desc:"Select All"
            },
            paste_dlg:{
                text_title:"Use CTRL+V on your keyboard to paste the text into the window.",
                text_linebreaks:"Keep linebreaks",
                word_title:"Use CTRL+V on your keyboard to paste the text into the window."
            },
            table:{
                desc:"Inserts a new table",
                row_before_desc:"Insert row before",
                row_after_desc:"Insert row after",
                delete_row_desc:"Delete row",
                col_before_desc:"Insert column before",
                col_after_desc:"Insert column after",
                delete_col_desc:"Remove column",
                split_cells_desc:"Split merged table cells",
                merge_cells_desc:"Merge table cells",
                row_desc:"Table row properties",
                cell_desc:"Table cell properties",
                props_desc:"Table properties",
                paste_row_before_desc:"Paste table row before",
                paste_row_after_desc:"Paste table row after",
                cut_row_desc:"Cut table row",
                copy_row_desc:"Copy table row",
                del:"Delete table",
                row:"Row",
                col:"Column",
                cell:"Cell"
            },
            autosave:{
                unload_msg:"The changes you made will be lost if you navigate away from this page."
            },
            fullscreen:{
                desc:"Toggle fullscreen mode"
            },
            media:{
                desc:"Insert / edit embedded media",
                edit:"Edit embedded media"
            },
            fullpage:{
                desc:"Document properties"
            },
            template:{
                desc:"Insert predefined template content"
            },
            visualchars:{
                desc:"Visual control characters on/off."
            },
            spellchecker:{
                desc:"Toggle spellchecker",
                menu:"Spellchecker settings",
                ignore_word:"Ignore word",
                ignore_words:"Ignore all",
                langs:"Languages",
                wait:"Please wait...",
                sug:"Suggestions",
                no_sug:"No suggestions",
                no_mpell:"No misspellings found."
            },
            pagebreak:{
                desc:"Insert page break."
            }
        }
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.table',{
        desc:"Insert Table",
        row_up:"Move Row Up",
        row_down:"Move Row Down",
        col_left:"Move Column Left",
        col_right:"Move Column Right"
    });
    tinyMCE.addI18n('en.common',{
        edit_confirm:"Do you want to use the WYSIWYG mode for this form?",
        apply:"Apply",
        insert:"Insert",
        update:"Update",
        cancel:"Cancel",
        close:"Close",
        browse:"Browse",
        class_name:"Class",
        not_set:"-- Not set --",
        clipboard_msg:"Copy/Cut/Paste is not available in Mozilla and Firefox.\nDo you want more information about this issue?",
        clipboard_no_support:"Currently not supported by your browser, use keyboard shortcuts instead.",
        popup_blocked:"Sorry, but we have noticed that your popup-blocker has disabled a window that provides application functionality. You will need to disable popup blocking on this site in order to fully utilize this tool.",
        invalid_data:"Error: Invalid values entered, these are marked in red.",
        more_colors:"More colors",
        close_modal:"Close Popup"
    });
    tinyMCE.addI18n('en.spellchecker',{
        desc:"Toggle Spell Checker",
        menu:"Spell Checker Settings",
        ignore_word:"Ignore Word",
        ignore_words:"Ignore All",
        langs:"Languages",
        wait:"Please wait...",
        sug:"Suggestions",
        no_sug:"No Suggestions",
        no_mpell:"No misspellings found.",
        learn_word:"Learn word"
    });
    tinyMCE.addI18n('en.aria', {
        rich_text_area: "Rich Text Area."
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivelists',{
        list_style : 'List Style',
        list_style_hdr : 'List Style:',
        inherit : "Inherit",
        none : "None",
        'default' : "Default",
        ur : "Upper Roman",
        lr : "Lower Roman",
        dz : "Decimal with Leading Zero",
        d  : "Decimal",
        ua : "Upper Alpha",
        la : "Lower Alpha",
        lg : "Lower Greek",
        ki : "Katakana-Iroha",
        hii: "Hiragana-Iroha",
        k  : "Katakana",
        hi : "Hiragana",
        ci : "Cjk-Ideographic",
        g  : "Georgian",
        a  : "Armenian",
        he : "Hebrew",
        s  : "Squares",
        c  : "Circles",
        di : "Discs"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivestyle',{
        title : 'Style',
        paragraph : 'Paragraph',
        header : 'Header'
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivemacros',{
        unlink : "Unlink",
        add : 'Insert',
        remove : 'Remove',
        unquote : 'Unquote',
        properties : 'Settings',
        title : 'Settings',
        presets : 'Presets',
        save: "Save",
        params : 'Parameters',
        'macro.toc': "Table of Contents",
        'macro.quote': "Quote",
        'macro.user': "User",
        'macro.youtube': "YouTube",
        'macro.youtube.attr.__default_attr': "URL or Video ID",
        'macro.youtube.attr.width': "Width",
        'macro.youtube.attr.height': "Height",
        'macro.code': "Syntax Highlighting",
        'macro.code.presets': "Format",
        'macro.code.attr.__default_attr': "Format",
        'macro.code.preset.plain': "Plain",
        'macro.code.preset.sql': "SQL",
        'macro.code.preset.java': "Java",
        'macro.code.preset.html': "Insert Raw HTML",
        'macro.code.preset.xml': "XML",
        'macro.alert': "Alert",
        'macro.alert.preset.success': "Success",
        'macro.alert.preset.info': "Information",
        'macro.alert.preset.warning': "Warning",
        'macro.alert.preset.danger': "Danger",
        'macro.flag': "Flag",
        'macro.flag.preset.new': "New",
        'macro.flag.preset.updated': "Updated",
        'macro.emoticon.presets': "Emoticons",
        'macro.emoticon.preset.angry': "Angry",
        'macro.emoticon.preset.blush': "Blush",
        'macro.emoticon.preset.confused': "Confused",
        'macro.emoticon.preset.cool': "Cool",
        'macro.emoticon.preset.cry': "Cry",
        'macro.emoticon.preset.devil': "Devil",
        'macro.emoticon.preset.grin': "Grin",
        'macro.emoticon.preset.happy': "Happy",
        'macro.emoticon.preset.laugh': "Laugh",
        'macro.emoticon.preset.love': "Love",
        'macro.emoticon.preset.mischief': "Mischief",
        'macro.emoticon.preset.plain': "Plain",
        'macro.emoticon.preset.sad': "Sad",
        'macro.emoticon.preset.shocked': "Shocked",
        'macro.emoticon.preset.silly': "Silly",
        'macro.emoticon.preset.wink': "Wink",
        'macro.emoticon.preset.info': "Info",
        'macro.emoticon.preset.plus': "Plus",
        'macro.emoticon.preset.minus': "Minus",
        'macro.emoticon.preset.alert': "Alert",
        'macro.emoticon.preset.check': "Check",
        'macro.emoticon.preset.x': "X"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivemacros',{
        add : 'Insert',
        remove : 'Remove',
        properties : 'Settings',
        title : 'Settings',
        params : 'Parameters',
        presets : 'Presets',
        save: "Save"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jiveattachment',{
        button_label : 'Attach',
        removeAttachmentButton : 'Remove'
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jiveapps',{
        edit_app : '! App'
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivemention',{
        mention_button_lbl : '@ Mention',
        no_notification : 'will not be notified of this mention, because they do not have access to this content.',
        secret_group_mention : 'is a secret group.  Anyone who can view this content can see the name of the secret group.',
        restricted_content_mention : 'is located in a member-restricted group.  Anyone who can view this content can see the name of the object.'
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivetable',{
        'transparent': "Transparent"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivetablecontrols',{
        add : 'Add',
        rows : 'Rows',
        add_row_before : 'Add Row Above',
        add_row_after : 'Add Row Below',
        delete_row : 'Delete Row',
        duplicate_row : 'Duplicate Row',
        add_col_before : 'Add Column Left',
        add_col_after : 'Add Column Right',
        delete_col : 'Delete Column',
        duplicate_col : 'Duplicate Column'
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivetablebutton',{
        'header': "Header"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jiveemoticons',{
        title : 'Insert emoticon',
        desc : 'Emoticons'
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivelink',{
        link_desc : 'Insert Link',
        unlink : 'Unlink',
        bareUrl : 'Bare URL',
        autoResolve : 'Auto-title',
        menu_hdr : 'Link:'
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jiveimage',{
        link_desc : 'Insert Image',
        menu_hdr : 'Image:',
        float_right : 'Float Right',
        float_left : 'Float Left',
        inline : 'Display Inline',
        original_size : 'Original Size',
        please_wait : 'Please wait while the images are uploaded, then retry.'
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivequote',{
        link_desc : 'Quote Previous Message'
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivevideo',{
        link_desc : 'Insert Video'
    });
});


;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.jivevideo',{
        num1: "1. ",
        num2: "2. ",
        title_new:"Insert Video",
        general_props:"Video Properties",
        site_title:"Select a Video Site",
        embed_title: "Enter Video Information",
        embed: "Video URL or Embed Code (example: http://youtube.com/watch?v=videoIdHere)",
        embed_error : "Please enter a valid URL or embed code",
        name_youtube: "YouTube",
        name_vimeo: "Vimeo",
        name_veoh: "Veoh",
        name_dailymotion: "Dailymotion",
        name_google: "Google",
        name_kaltura: "Kaltura",
        name_brightcove: "Brightcove",
        name_showandshare: "Show and Share"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.tabletoolbar',{
        title : 'Insert Table'
    });
});

;
require([
    'tinyMCE'
], function (tinyMCE) {
    tinyMCE.addI18n('en.table_dlg', {
        "rules_border": "border",
        "rules_box": "box",
        "rules_vsides": "vsides",
        "rules_rhs": "rhs",
        "rules_lhs": "lhs",
        "rules_hsides": "hsides",
        "rules_below": "below",
        "rules_above": "above",
        "rules_void": "void",
        rules: "Rules",
        "frame_all": "all",
        "frame_cols": "cols",
        "frame_rows": "rows",
        "frame_groups": "groups",
        "frame_none": "none",
        frame: "Frame",
        caption: "Table Caption",
        "missing_scope": "Are you sure you want to continue without specifying a scope for this table header cell. Without it, it may be difficult for some users with disabilities to understand the content or data displayed of the table.",
        "cell_limit": "You\'ve exceeded the maximum number of cells of {$cells}.",
        "row_limit": "You\'ve exceeded the maximum number of rows of {$rows}.",
        "col_limit": "You\'ve exceeded the maximum number of columns of {$cols}.",
        colgroup: "Col Group",
        rowgroup: "Row Group",
        scope: "Scope",
        tfoot: "Footer",
        tbody: "Body",
        thead: "Header",
        "row_all": "Update All Rows in Table",
        "row_even": "Update Even Rows in Table",
        "row_odd": "Update Odd Rows in Table",
        "row_row": "Update Current Row",
        "cell_all": "Update All Cells in Table",
        "cell_row": "Update All Cells in Row",
        "cell_cell": "Update Current Cell",
        th: "Header",
        td: "Data",
        summary: "Summary",
        bgimage: "Background Image",
        rtl: "Right to Left",
        ltr: "Left to Right",
        mime: "Target MIME Type",
        langcode: "Language Code",
        langdir: "Language Direction",
        style: "Style",
        id: "ID",
        "merge_cells_title": "Merge Table Cells",
        bgcolor: "Background Color",
        bordercolor: "Border Color",
        "align_bottom": "Bottom",
        "align_top": "Top",
        valign: "Vertical Alignment",
        "cell_type": "Cell Type",
        "cell_title": "Table Cell Properties",
        "row_title": "Table Row Properties",
        "align_middle": "Center",
        "align_right": "Right",
        "align_left": "Left",
        "align_default": "Default",
        align: "Alignment",
        border: "Border",
        cellpadding: "Cell Padding",
        cellspacing: "Cell Spacing",
        rows: "Rows",
        cols: "Columns",
        height: "Height",
        width: "Width",
        title: "Insert/Edit Table",
        rowtype: "Row Type",
        "advanced_props": "Advanced Properties",
        "general_props": "General Properties",
        "advanced_tab": "Advanced",
        "general_tab": "General",
        "cell_col": "Update all cells in column"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.table_dlg',{
        title_new:"Insert table",
        title_edit:"Modify table",
        merge_cells_description: "Choose the number of cells to the right and below the current cell that you would like to merge. Choose &apos;0&apos; if you do not want to merge any cells in the given direction."
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.html',{
        desc:"Toggle HTML mode"
    });
});

;
require([
    'tinyMCE'
], function (tinyMCE) {
    tinyMCE.addI18n('en.advimage_dlg', {
        "image_list": "Image List",
        "align_right": "Right",
        "align_left": "Left",
        "align_textbottom": "Text Bottom",
        "align_texttop": "Text Top",
        "align_bottom": "Bottom",
        "align_middle": "Middle",
        "align_top": "Top",
        "align_baseline": "Baseline",
        align: "Alignment",
        hspace: "Horizontal Space",
        vspace: "Vertical Space",
        dimensions: "Dimensions",
        border: "Border",
        list: "Image List",
        alt: "Image Description",
        src: "Image URL",
        "dialog_title": "Insert/Edit Image",
        "missing_alt": "Are you sure you want to continue without including an Image Description? Without it the image may not be accessible to some users with disabilities, or to those using a text browser, or browsing the Web with images turned off.",
        "example_img": "Appearance Preview Image",
        misc: "Miscellaneous",
        mouseout: "For Mouse Out",
        mouseover: "For Mouse Over",
        "alt_image": "Alternative Image",
        "swap_image": "Swap Image",
        map: "Image Map",
        id: "ID",
        rtl: "Right to Left",
        ltr: "Left to Right",
        classes: "Classes",
        style: "Style",
        "long_desc": "Long Description Link",
        langcode: "Language Code",
        langdir: "Language Direction",
        "constrain_proportions": "Constrain Proportions",
        preview: "Preview",
        title: "Title",
        general: "General",
        "tab_advanced": "Advanced",
        "tab_appearance": "Appearance",
        "tab_general": "General",
        width: "Width",
        height: "Height"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.advimage_dlg',{
        dialog_title:"Insert Image",
        src:"URL",
        align_inline:"Normal",
        align_nowrap:"No Wrap",
        insert_desc : "Use the form below to insert a remote image from a web page into your discussion, document, blog post or comment.",
        from_the_web: "From the Web",
        example: "example",
        insert: "Insert image"
    });
});

;
require([
    'tinyMCE'
], function (tinyMCE) {
    tinyMCE.addI18n('en.advlink_dlg', {
        "target_name": "Target Name",
        classes: "Classes",
        style: "Style",
        id: "ID",
        "popup_position": "Position (X/Y)",
        langdir: "Language Direction",
        "popup_size": "Size",
        "popup_dependent": "Dependent (Mozilla/Firefox Only)",
        "popup_resizable": "Make Window Resizable",
        "popup_location": "Show Location Bar",
        "popup_menubar": "Show Menu Bar",
        "popup_toolbar": "Show Toolbars",
        "popup_statusbar": "Show Status Bar",
        "popup_scrollbars": "Show Scrollbars",
        "popup_return": "Insert \'return false\'",
        "popup_name": "Window Name",
        "popup_url": "Popup URL",
        popup: "JavaScript Popup",
        "target_blank": "Open in New Window",
        "target_top": "Open in Top Frame (Replaces All Frames)",
        "target_parent": "Open in Parent Window/Frame",
        "target_same": "Open in This Window/Frame",
        "anchor_names": "Anchors",
        "popup_opts": "Options",
        "advanced_props": "Advanced Properties",
        "event_props": "Events",
        "popup_props": "Popup Properties",
        "general_props": "General Properties",
        "advanced_tab": "Advanced",
        "events_tab": "Events",
        "popup_tab": "Popup",
        "general_tab": "General",
        list: "Link List",
        "is_external": "The URL you entered seems to be an external link. Do you want to add the required http:// prefix?",
        "is_email": "The URL you entered seems to be an email address. Do you want to add the required mailto: prefix?",
        titlefield: "Title",
        target: "Target",
        url: "Link URL",
        title: "Insert/Edit Link",
        "link_list": "Link List",
        rtl: "Right to Left",
        ltr: "Left to Right",
        accesskey: "AccessKey",
        tabindex: "TabIndex",
        rev: "Relationship Target to Page",
        rel: "Relationship Page to Target",
        mime: "Target MIME Type",
        encoding: "Target Character Encoding",
        langcode: "Language Code",
        "target_langcode": "Target Language",
        width: "Width",
        height: "Height"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.advanced',{
        style_select:"Styles",
        font_size:"Font size",
        fontdefault:"Font family",
        block:"Format",
        paragraph:"Paragraph",
        div:"Div",
        address:"Address",
        pre:"Preformatted",
        h1:"Heading 1",
        h2:"Heading 2",
        h3:"Heading 3",
        h4:"Heading 4",
        h5:"Heading 5",
        h6:"Heading 6",
        blockquote:"Blockquote",
        code:"Code",
        samp:"Code sample",
        dt:"Definition term ",
        dd:"Definition description",
        bold_desc:"Bold (Ctrl+B)",
        italic_desc:"Italic (Ctrl+I)",
        underline_desc:"Underline (Ctrl+U)",
        striketrough_desc:"Strikethrough",
        justifyleft_desc:"Align left",
        justifycenter_desc:"Align center",
        justifyright_desc:"Align right",
        justifyfull_desc:"Align full",
        bullist_desc:"Unordered list",
        numlist_desc:"Ordered list",
        outdent_desc:"Outdent",
        indent_desc:"Indent",
        undo_desc:"Undo (Ctrl+Z)",
        redo_desc:"Redo (Ctrl+Y)",
        link_desc:"Insert/edit link",
        unlink_desc:"Unlink",
        image_desc:"Insert/edit image",
        cleanup_desc:"Cleanup messy code",
        code_desc:"Edit HTML Source",
        sub_desc:"Subscript",
        sup_desc:"Superscript",
        hr_desc:"Insert horizontal ruler",
        removeformat_desc:"Remove formatting",
        custom1_desc:"Your custom description here",
        forecolor_desc:"Select text color",
        backcolor_desc:"Select background color",
        charmap_desc:"Insert custom character",
        visualaid_desc:"Toggle guidelines/invisible elements",
        anchor_desc:"Insert/edit anchor",
        cut_desc:"Cut",
        copy_desc:"Copy",
        paste_desc:"Paste",
        image_props_desc:"Image properties",
        newdocument_desc:"New document",
        help_desc:"Help",
        blockquote_desc:"Blockquote",
        clipboard_msg:"Copy/Cut/Paste is not available in Mozilla and Firefox.\r\nDo you want more information about this issue?",
        path:"Path",
        newdocument:"Are you sure you want clear all contents?",
        toolbar_focus:"Jump to tool buttons - Ctrl+Shift+q, Jump to editor - Alt-Z",
        more_colors:"More colors"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.advanced',{
        style_select: "Styles",
        font_size: "Font size",
        fontdefault: "Font family",
        block: "Format",
        paragraph: "Paragraph",
        div: "Div",
        address: "Address",
        pre: "Preformatted",
        h1: "Heading 1",
        h2: "Heading 2",
        h3: "Heading 3",
        h4: "Heading 4",
        h5: "Heading 5",
        h6: "Heading 6",
        blockquote: "Blockquote",
        code: "Code",
        samp: "Code sample",
        dt: "Definition term",
        dd: "Definition description",
        bold_desc: "Bold (Ctrl+B)",
        italic_desc: "Italic (Ctrl+I)",
        underline_desc: "Underline (Ctrl+U)",
        striketrough_desc: "Strikethrough",
        justifyleft_desc: "Align left",
        justifycenter_desc: "Align center",
        justifyright_desc: "Align right",
        justifyfull_desc: "Align full",
        bullist_desc: "Unordered list",
        numlist_desc: "Ordered list",
        outdent_desc: "Outdent",
        indent_desc: "Indent",
        undo_desc: "Undo (Ctrl+Z)",
        redo_desc: "Redo (Ctrl+Y)",
        link_desc: "Insert/edit link",
        unlink_desc: "Unlink",
        image_desc: "Insert/edit image",
        cleanup_desc: "Cleanup messy code",
        code_desc: "Edit HTML Source",
        sub_desc: "Subscript",
        sup_desc: "Superscript",
        hr_desc: "Insert horizontal ruler",
        removeformat_desc: "Remove formatting",
        custom1_desc: "Your custom description here",
        forecolor_desc: "Select text color",
        backcolor_desc: "Select background color",
        charmap_desc: "Insert custom character",
        visualaid_desc: "Toggle guidelines/invisible elements",
        anchor_desc: "Insert/edit anchor",
        cut_desc: "Cut",
        copy_desc: "Copy",
        paste_desc: "Paste",
        image_props_desc: "Image properties",
        newdocument_desc: "New document",
        help_desc: "Help",
        blockquote_desc: "Blockquote",
        clipboard_msg: "Copy/Cut/Paste is not available in Mozilla and Firefox.\r\nDo you want more information about this issue?",
        path: "Path",
        newdocument: "Are you sure you want clear all contents?",
        toolbar_focus: "Jump to tool buttons - Alt+Q",
        more_colors: "More colors",

        spellchecker_desc: "Check Spelling",
        insert_image_desc: "Insert image",
        edit_image_desc: "Edit image",

        colorpicker_apply:"Apply",
        colorpicker_color:"Color",
        colorpicker_picker_tab:"Picker",
        colorpicker_palette_tab:"Palette",
        colorpicker_named_tab:"Named",
        colorpicker_name:"Name",
        colorpicker_picker_title:"Color picker",
        colorpicker_palette_title:"Palette colors",
        colorpicker_named_title:"Named colors",
        colorpicker_title:"Color picker"
    });
});

;
require([
    'tinyMCE'
], function(tinyMCE) {
    tinyMCE.addI18n('en.advanced_dlg',{
        about_title:"About TinyMCE",
        about_general:"About",
        about_help:"Help",
        about_license:"License",
        about_plugins:"Plugins",
        about_plugin:"Plugin",
        about_author:"Author",
        about_version:"Version",
        about_loaded:"Loaded plugins",
        anchor_title:"Insert/edit anchor",
        anchor_name:"Anchor name",
        code_title:"HTML Source Editor",
        code_wordwrap:"Word wrap",
        colorpicker_title:"Select a color",
        colorpicker_picker_tab:"Picker",
        colorpicker_picker_title:"Color picker",
        colorpicker_palette_tab:"Palette",
        colorpicker_palette_title:"Palette colors",
        colorpicker_named_tab:"Named",
        colorpicker_named_title:"Named colors",
        colorpicker_color:"Color:",
        colorpicker_name:"Name:",
        charmap_title:"Select custom character",
        image_title:"Insert/edit image",
        image_src:"Image URL",
        image_alt:"Image description",
        image_list:"Image list",
        image_border:"Border",
        image_dimensions:"Dimensions",
        image_vspace:"Vertical space",
        image_hspace:"Horizontal space",
        image_align:"Alignment",
        image_align_baseline:"Baseline",
        image_align_top:"Top",
        image_align_middle:"Middle",
        image_align_bottom:"Bottom",
        image_align_texttop:"Text top",
        image_align_textbottom:"Text bottom",
        image_align_left:"Left",
        image_align_right:"Right",
        link_title:"Insert/edit link",
        link_url:"Link URL",
        link_target:"Target",
        link_target_same:"Open link in the same window",
        link_target_blank:"Open link in a new window",
        link_titlefield:"Title",
        link_is_email:"The URL you entered seems to be an email address, do you want to add the required mailto: prefix?",
        link_is_external:"The URL you entered seems to external link, do you want to add the required http:// prefix?",
        link_list:"Link list"
    });
});

;
