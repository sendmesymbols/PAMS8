"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
class Plan {
    constructor(data) {
        const base = Plan.createDefaultObject();
        this.poObj = {
            ...base,
            ...data,
            plns: data?.plns ?? base.plns,
            ordrs: data?.ordrs ?? base.ordrs,
            plnOrdrHdrCntnts: data?.plnOrdrHdrCntnts ?? base.plnOrdrHdrCntnts,
            orgPoas: data?.orgPoas ?? base.orgPoas,
            plnOrdrOverlay: data?.plnOrdrOverlay ?? base.plnOrdrOverlay,
        };
    }
    toJSON() {
        return { poObj: this.poObj };
    }
    setOverlays(overlays) {
        this.poObj.plnOrdrOverlay = overlays;
    }
    addOverlay(overlay) {
        this.poObj.plnOrdrOverlay.push(overlay);
    }
    static isPlanDocument(data) {
        const doc = data;
        return !!doc?.poObj && Array.isArray(doc.poObj.plnOrdrOverlay);
    }
    static createOverlay(planId, overlayId, name, seqOrdr, symbols, creatorId = 10900) {
        return {
            plnOrdrOverlayPK: {
                plnOrdrId: planId,
                plnOrdrOverlayId: overlayId,
            },
            nameTxt: name,
            typeTxt: name,
            seqOrdr,
            hierarchyType: 'Simple Overlay',
            isDelete: 'N',
            isShared: 'N',
            creatorId,
            updateSeqnr: 1,
            plnOrdrSymbolSet: symbols,
        };
    }
    static createSymbol(planId, overlayId, symbolId, drawEss, creatorId = 10900) {
        return {
            plnOrdrSymbolPK: {
                plnOrdrId: planId,
                plnOrdrSymbolId: symbolId,
                plnOrdrOverlayId: overlayId,
            },
            isDelete: 'N',
            isShared: 'N',
            creatorId,
            updateSeqnr: 1,
            drawEss,
        };
    }
    static createDefaultObject(planId) {
        const resolvedPlanId = planId ?? Date.now();
        const now = new Date();
        const pad = (n, l = 2) => `${n}`.padStart(l, '0');
        const dttm = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
            `${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}${pad(now.getUTCSeconds())}000 `;
        return {
            plnOrdrId: resolvedPlanId,
            catCode: 'PLAN',
            creatorId: 10900,
            updateSeqnr: 1,
            plns: [
                {
                    plnId: resolvedPlanId,
                    catCode: 'OPLAN',
                    subCatCode: 'Def',
                    creatorId: 10900,
                    updateSeqnr: 1,
                    plnStats: [
                        {
                            id: {
                                plnId: resolvedPlanId,
                                plnStatIx: 1,
                            },
                            dvlpmStatCode: 'NCOMPL',
                            stateCode: 'DRAFT',
                            dttm,
                            creatorId: 10900,
                            updateSeqnr: 1,
                        },
                    ],
                },
            ],
            ordrs: [],
            plnOrdrHdrCntnts: [
                {
                    id: {
                        plnOrdrId: resolvedPlanId,
                        plnOrdrHdrCntntIx: 1,
                    },
                    nameTxt: 'Sample Name',
                    nicknameTxt: 'Plan',
                    serialNoTxt: '11-00',
                    sponsorTypeTxt: 'SPO',
                    timeZoneCode: 'Z',
                    dttm,
                    creatorId: 10900,
                    updateSeqnr: 1,
                    placeOfIssueTxt: 'Office',
                },
            ],
            orgPoas: [],
            plnOrdrOverlay: [],
        };
    }
    static _toNumber(value) {
        if (typeof value === 'number' && Number.isFinite(value))
            return value;
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed.length)
                return undefined;
            const parsed = Number(trimmed);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
        return undefined;
    }
    static _toStringNumber(value) {
        const num = Plan._toNumber(value);
        return num === undefined ? undefined : `${num}`;
    }
    static _clone(value) {
        if (value === null || value === undefined)
            return value;
        if (Array.isArray(value)) {
            return value.map((item) => Plan._clone(item));
        }
        if (typeof value !== 'object')
            return value;
        const out = {};
        Object.keys(value).forEach((k) => {
            out[k] = Plan._clone(value[k]);
        });
        return out;
    }
    static _ensureObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value)
            ? value
            : {};
    }
    static _normalizeLabelOptionsForExport(raw, geoType) {
        const labelOptions = {
            ...Plan.LEGACY_LABEL_OPTIONS_DEFAULT,
            ...Plan._ensureObject(raw),
        };
        if (geoType === 'Point') {
            const textSize = Plan._toStringNumber(labelOptions.textSize);
            const haloColorSize = Plan._toStringNumber(labelOptions.haloColorSize);
            if (textSize !== undefined)
                labelOptions.textSize = textSize;
            if (haloColorSize !== undefined)
                labelOptions.haloColorSize = haloColorSize;
        }
        return labelOptions;
    }
    static _normalizeAmplifierForExport(raw, geoType) {
        const amp = {
            ...Plan.LEGACY_AMPLIFIER_DEFAULT,
            ...Plan._ensureObject(raw),
        };
        if (geoType === 'Area') {
            if (amp.DTG === undefined)
                amp.DTG = '';
            if (amp.DTGTO === undefined)
                amp.DTGTO = '';
            if (amp.ph === undefined)
                amp.ph = '';
        }
        return amp;
    }
    static normalizeDrawEssForLegacyExport(rawDrawEss) {
        const drawEss = Plan._ensureObject(Plan._clone(rawDrawEss));
        const geoType = `${drawEss.SYM_GEO_TYPE ?? ''}`;
        if (drawEss.FLAP_ANGLE === undefined)
            drawEss.FLAP_ANGLE = 45;
        if (drawEss.BK_LN_DIST_RATIO === undefined)
            drawEss.BK_LN_DIST_RATIO = 5;
        if (drawEss.BK_LN_ANGL_RATIO === undefined)
            drawEss.BK_LN_ANGL_RATIO = 5;
        if (drawEss.FRNT_LN_ANGL_RATIO === undefined)
            drawEss.FRNT_LN_ANGL_RATIO = 0.8;
        if (drawEss.FRNT_LN_DIST_RATIO === undefined)
            drawEss.FRNT_LN_DIST_RATIO = 1.5;
        if (drawEss.FLAP_DIST_RATIO === undefined)
            drawEss.FLAP_DIST_RATIO = 3;
        drawEss.extraSettings = {
            ...Plan.LEGACY_EXTRA_SETTINGS_DEFAULT,
            ...Plan._ensureObject(drawEss.extraSettings),
        };
        drawEss.AMPLIFIER = Plan._normalizeAmplifierForExport(drawEss.AMPLIFIER, geoType);
        drawEss.labelOptions = Plan._normalizeLabelOptionsForExport(drawEss.labelOptions, geoType);
        if (geoType === 'FPoint') {
            const options = Plan._ensureObject(drawEss.OPTIONS);
            // Handle labelOptions: if it's 0 or not an object, normalize it properly
            if (options.labelOptions === 0 ||
                options.labelOptions === undefined ||
                typeof options.labelOptions !== 'object' ||
                Array.isArray(options.labelOptions)) {
                options.labelOptions = Plan._normalizeLabelOptionsForExport(undefined, geoType);
            }
            else {
                options.labelOptions = Plan._normalizeLabelOptionsForExport(options.labelOptions, geoType);
            }
            if (options.msn === undefined)
                options.msn = '';
            if (options.ph === undefined)
                options.ph = '';
            if (options.roa === undefined)
                options.roa = '';
            const optSize = options.size;
            if (optSize !== undefined)
                options.size = `${optSize}`;
            drawEss.OPTIONS = options;
        }
        if (geoType === 'Point') {
            if (drawEss.ISFHAND === undefined)
                drawEss.ISFHAND = 0;
            if (drawEss.FRHNDSZ === undefined)
                drawEss.FRHNDSZ = 0;
            if (drawEss.FRHNDWDTH === undefined)
                drawEss.FRHNDWDTH = 0;
            if (drawEss.OFFSET === undefined)
                drawEss.OFFSET = '0';
        }
        if (geoType === 'Line') {
            if (drawEss.DRAW_TYPE === undefined)
                drawEss.DRAW_TYPE = 1;
            if (drawEss.drawExtendType === undefined)
                drawEss.drawExtendType = 1;
            if (drawEss.ISFHAND === undefined)
                drawEss.ISFHAND = 0;
            if (drawEss.FRHNDSZ === undefined)
                drawEss.FRHNDSZ = 0;
            if (drawEss.FRHNDWDTH === undefined)
                drawEss.FRHNDWDTH = 0;
        }
        if (geoType === 'Area') {
            if (drawEss.DRAW_TYPE === undefined)
                drawEss.DRAW_TYPE = 1;
            if (drawEss.FACE_GAP === undefined)
                drawEss.FACE_GAP = 5;
            if (drawEss.drawExtendType === undefined)
                drawEss.drawExtendType = 1;
            const headRatio = Plan._toStringNumber(drawEss.HEAD_RATIO);
            const tailFactor = Plan._toStringNumber(drawEss.TAIL_FACTOR);
            if (headRatio !== undefined)
                drawEss.HEAD_RATIO = headRatio;
            if (tailFactor !== undefined)
                drawEss.TAIL_FACTOR = tailFactor;
        }
        return drawEss;
    }
    static normalizeDrawEssForRuntime(rawDrawEss) {
        const drawEss = Plan._ensureObject(Plan._clone(rawDrawEss));
        const geoType = `${drawEss.SYM_GEO_TYPE ?? ''}`;
        if (drawEss.FLAP_ANGLE === undefined)
            drawEss.FLAP_ANGLE = 45;
        if (drawEss.BK_LN_DIST_RATIO === undefined)
            drawEss.BK_LN_DIST_RATIO = 5;
        if (drawEss.BK_LN_ANGL_RATIO === undefined)
            drawEss.BK_LN_ANGL_RATIO = 5;
        if (drawEss.FRNT_LN_ANGL_RATIO === undefined)
            drawEss.FRNT_LN_ANGL_RATIO = 0.8;
        if (drawEss.FRNT_LN_DIST_RATIO === undefined)
            drawEss.FRNT_LN_DIST_RATIO = 1.5;
        if (drawEss.FLAP_DIST_RATIO === undefined)
            drawEss.FLAP_DIST_RATIO = 3;
        drawEss.extraSettings = {
            ...Plan.LEGACY_EXTRA_SETTINGS_DEFAULT,
            ...Plan._ensureObject(drawEss.extraSettings),
        };
        const labelOptions = Plan._ensureObject(drawEss.labelOptions);
        const haloSize = Plan._toNumber(labelOptions.haloColorSize);
        const textSize = Plan._toNumber(labelOptions.textSize);
        if (haloSize !== undefined)
            labelOptions.haloColorSize = haloSize;
        if (textSize !== undefined)
            labelOptions.textSize = textSize;
        drawEss.labelOptions = labelOptions;
        if (geoType === 'Area') {
            const headRatio = Plan._toNumber(drawEss.HEAD_RATIO);
            const tailFactor = Plan._toNumber(drawEss.TAIL_FACTOR);
            if (headRatio !== undefined)
                drawEss.HEAD_RATIO = headRatio;
            if (tailFactor !== undefined)
                drawEss.TAIL_FACTOR = tailFactor;
            if (drawEss.DRAW_TYPE === undefined)
                drawEss.DRAW_TYPE = 1;
            if (drawEss.FACE_GAP === undefined)
                drawEss.FACE_GAP = 5;
            if (drawEss.drawExtendType === undefined)
                drawEss.drawExtendType = 1;
        }
        if (geoType === 'FPoint') {
            const options = Plan._ensureObject(drawEss.OPTIONS);
            if (options.labelOptions === undefined ||
                typeof options.labelOptions !== 'object' ||
                Array.isArray(options.labelOptions)) {
                options.labelOptions = Plan._clone(Plan.LEGACY_LABEL_OPTIONS_DEFAULT);
            }
            drawEss.OPTIONS = options;
        }
        drawEss.AMPLIFIER = Plan._ensureObject(drawEss.AMPLIFIER);
        return drawEss;
    }
}
Plan.LEGACY_LABEL_OPTIONS_DEFAULT = {
    haloColor: [255, 0, 0],
    haloColorSize: 5,
    color: [0, 255, 0],
    textSize: 20,
    bold: 1,
    italic: 0,
    uLine: 0,
    oLine: 0,
    tLine: 0,
};
Plan.LEGACY_AMPLIFIER_DEFAULT = {
    UNIQUE_DESIG: 'Unique Designation',
    UNIQUE_DESIG_ID: '',
    HIGHER_FORM: 'Higher Formation',
    hfid: '',
    STAFF_COM: 'Staff Comments',
    ADDL_INFO: 'Additional Information',
    MULTI_LINE_LABEL_TEXT: '',
    MULTI_LINE_LABEL_COLOR: '#000000',
    MULTI_LINE_LABEL_ALIGN: 'center',
};
Plan.LEGACY_EXTRA_SETTINGS_DEFAULT = {
    lineWidth: 3,
    size: 20,
    textSize: 12,
    opacity: 1,
};
exports.default = Plan;
