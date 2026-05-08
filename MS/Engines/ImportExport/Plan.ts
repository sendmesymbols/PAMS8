export interface PlanPoint {
  type: 'point';
  x: number;
  y: number;
  sp: string;
}

export interface PlanSymbolPK {
  plnOrdrId: number;
  plnOrdrSymbolId: string;
  plnOrdrOverlayId: string;
}

export interface PlanSymbol {
  plnOrdrSymbolPK: PlanSymbolPK;
  isDelete: 'N' | 'Y';
  isShared: 'N' | 'Y';
  creatorId: number;
  updateSeqnr: number;
  drawEss: string;
}

export interface PlanOverlayPK {
  plnOrdrId: number;
  plnOrdrOverlayId: string;
}

export interface PlanOverlay {
  plnOrdrOverlayPK: PlanOverlayPK;
  nameTxt: string;
  typeTxt: string;
  seqOrdr: number;
  hierarchyType: string;
  isDelete: 'N' | 'Y';
  isShared: 'N' | 'Y';
  creatorId: number;
  updateSeqnr: number;
  plnOrdrSymbolSet: PlanSymbol[];
}

export interface PlanHeaderContent {
  id: {
    plnOrdrId: number;
    plnOrdrHdrCntntIx: number;
  };
  nameTxt: string;
  nicknameTxt: string;
  serialNoTxt: string;
  sponsorTypeTxt: string;
  timeZoneCode: string;
  dttm: string;
  creatorId: number;
  updateSeqnr: number;
  placeOfIssueTxt: string;
}

export interface PlanStatus {
  id: {
    plnId: number;
    plnStatIx: number;
  };
  dvlpmStatCode: string;
  stateCode: string;
  dttm: string;
  creatorId: number;
  updateSeqnr: number;
}

export interface PlanEntry {
  plnId: number;
  catCode: string;
  subCatCode: string;
  creatorId: number;
  updateSeqnr: number;
  plnStats: PlanStatus[];
}

export interface PlanObject {
  plnOrdrId: number;
  catCode: string;
  creatorId: number;
  updateSeqnr: number;
  plns: PlanEntry[];
  ordrs: unknown[];
  plnOrdrHdrCntnts: PlanHeaderContent[];
  orgPoas: unknown[];
  plnOrdrOverlay: PlanOverlay[];
}

export interface PlanDocument {
  poObj: PlanObject;
}

export default class Plan {
  private static readonly LEGACY_LABEL_OPTIONS_DEFAULT = {
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

  private static readonly LEGACY_AMPLIFIER_DEFAULT = {
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

  private static readonly LEGACY_EXTRA_SETTINGS_DEFAULT = {
    lineWidth: 3,
    size: 20,
    textSize: 12,
    opacity: 1,
  };

  public poObj: PlanObject;

  constructor(data?: Partial<PlanObject>) {
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

  public toJSON(): PlanDocument {
    return { poObj: this.poObj };
  }

  public setOverlays(overlays: PlanOverlay[]): void {
    this.poObj.plnOrdrOverlay = overlays;
  }

  public addOverlay(overlay: PlanOverlay): void {
    this.poObj.plnOrdrOverlay.push(overlay);
  }

  public static isPlanDocument(data: unknown): data is PlanDocument {
    const doc = data as PlanDocument;
    return !!doc?.poObj && Array.isArray(doc.poObj.plnOrdrOverlay);
  }

  public static createOverlay(
    planId: number,
    overlayId: string,
    name: string,
    seqOrdr: number,
    symbols: PlanSymbol[],
    creatorId = 10900,
  ): PlanOverlay {
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

  public static createSymbol(
    planId: number,
    overlayId: string,
    symbolId: string,
    drawEss: string,
    creatorId = 10900,
  ): PlanSymbol {
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

  public static createDefaultObject(planId?: number): PlanObject {
    const resolvedPlanId = planId ?? Date.now();
    const now = new Date();
    const pad = (n: number, l = 2) => `${n}`.padStart(l, '0');
    const dttm =
      `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(now.getUTCDate())}` +
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

  private static _toNumber(value: unknown): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed.length) return undefined;
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
  }

  private static _toStringNumber(value: unknown): string | undefined {
    const num = Plan._toNumber(value);
    return num === undefined ? undefined : `${num}`;
  }

  private static _clone<T>(value: T): T {
    if (value === null || value === undefined) return value;
    if (Array.isArray(value)) {
      return value.map((item) => Plan._clone(item)) as T;
    }
    if (typeof value !== 'object') return value;
    const out: Record<string, unknown> = {};
    Object.keys(value as Record<string, unknown>).forEach((k) => {
      out[k] = Plan._clone((value as Record<string, unknown>)[k]);
    });
    return out as T;
  }

  private static _ensureObject(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private static _normalizeLabelOptionsForExport(
    raw: unknown,
    geoType: string,
  ): Record<string, unknown> {
    const labelOptions = {
      ...Plan.LEGACY_LABEL_OPTIONS_DEFAULT,
      ...Plan._ensureObject(raw),
    } as Record<string, unknown>;

    if (geoType === 'Point') {
      const textSize = Plan._toStringNumber(labelOptions.textSize);
      const haloColorSize = Plan._toStringNumber(labelOptions.haloColorSize);
      if (textSize !== undefined) labelOptions.textSize = textSize;
      if (haloColorSize !== undefined) labelOptions.haloColorSize = haloColorSize;
    }

    return labelOptions;
  }

  private static _normalizeAmplifierForExport(
    raw: unknown,
    geoType: string,
  ): Record<string, unknown> {
    const amp = {
      ...Plan.LEGACY_AMPLIFIER_DEFAULT,
      ...Plan._ensureObject(raw),
    } as Record<string, unknown>;

    if (geoType === 'Area') {
      if (amp.DTG === undefined) amp.DTG = '';
      if (amp.DTGTO === undefined) amp.DTGTO = '';
      if (amp.ph === undefined) amp.ph = '';
    }

    return amp;
  }

  public static normalizeDrawEssForLegacyExport(rawDrawEss: unknown): Record<string, unknown> {
    const drawEss = Plan._ensureObject(Plan._clone(rawDrawEss));
    const geoType = `${drawEss.SYM_GEO_TYPE ?? ''}`;

    if (drawEss.FLAP_ANGLE === undefined) drawEss.FLAP_ANGLE = 45;
    if (drawEss.BK_LN_DIST_RATIO === undefined) drawEss.BK_LN_DIST_RATIO = 5;
    if (drawEss.BK_LN_ANGL_RATIO === undefined) drawEss.BK_LN_ANGL_RATIO = 5;
    if (drawEss.FRNT_LN_ANGL_RATIO === undefined) drawEss.FRNT_LN_ANGL_RATIO = 0.8;
    if (drawEss.FRNT_LN_DIST_RATIO === undefined) drawEss.FRNT_LN_DIST_RATIO = 1.5;
    if (drawEss.FLAP_DIST_RATIO === undefined) drawEss.FLAP_DIST_RATIO = 3;

    drawEss.extraSettings = {
      ...Plan.LEGACY_EXTRA_SETTINGS_DEFAULT,
      ...Plan._ensureObject(drawEss.extraSettings),
    };

    drawEss.AMPLIFIER = Plan._normalizeAmplifierForExport(drawEss.AMPLIFIER, geoType);

    if (geoType === 'FPoint') {
      const options = Plan._ensureObject(drawEss.OPTIONS);
      if (options.SYM_NAME === undefined) options.SYM_NAME = '';
      if (options.roa === undefined) options.roa = '';
      if (options.msn === undefined) options.msn = '';
      if (options.hfid === undefined) options.hfid = '';
      if (options.ph === undefined) options.ph = '';
      if (options.uniqueDesignationID === undefined) options.uniqueDesignationID = '';
      if (options.direction === undefined) options.direction = '';
      if (options.quantity === undefined) options.quantity = '';
      if (options.reinforcedReduced === undefined) options.reinforcedReduced = '';
      const optSize = options.size;
      if (optSize !== undefined) options.size = `${optSize}`;
      if (options.ANGLE === undefined) options.ANGLE = 0;
      if (options.ECHELON === undefined) options.ECHELON = '';
      if (options.alphaNum === undefined) options.alphaNum = 100;
      if (options.opacity === undefined) options.opacity = 1;
      if (options.symType === undefined) options.symType = 'FPoint';
      options.labelOptions = {};
      drawEss.OPTIONS = options;
      drawEss.labelOptions = {};
    } else {
      drawEss.labelOptions = Plan._normalizeLabelOptionsForExport(
        drawEss.labelOptions,
        geoType,
      );
    }

    if (geoType === 'Point') {
      if (drawEss.ISFHAND === undefined) drawEss.ISFHAND = 0;
      if (drawEss.FRHNDSZ === undefined) drawEss.FRHNDSZ = 0;
      if (drawEss.FRHNDWDTH === undefined) drawEss.FRHNDWDTH = 0;
      if (drawEss.OFFSET === undefined) drawEss.OFFSET = '0';
    }

    if (geoType === 'Line') {
      if (drawEss.DRAW_TYPE === undefined) drawEss.DRAW_TYPE = 1;
      if (drawEss.drawExtendType === undefined) drawEss.drawExtendType = 1;
      if (drawEss.ISFHAND === undefined) drawEss.ISFHAND = 0;
      if (drawEss.FRHNDSZ === undefined) drawEss.FRHNDSZ = 0;
      if (drawEss.FRHNDWDTH === undefined) drawEss.FRHNDWDTH = 0;
    }

    if (geoType === 'Area') {
      if (drawEss.DRAW_TYPE === undefined) drawEss.DRAW_TYPE = 1;
      if (drawEss.FACE_GAP === undefined) drawEss.FACE_GAP = 5;
      if (drawEss.drawExtendType === undefined) drawEss.drawExtendType = 1;

      const headRatio = Plan._toStringNumber(drawEss.HEAD_RATIO);
      const tailFactor = Plan._toStringNumber(drawEss.TAIL_FACTOR);
      if (headRatio !== undefined) drawEss.HEAD_RATIO = headRatio;
      if (tailFactor !== undefined) drawEss.TAIL_FACTOR = tailFactor;
    }

    return drawEss;
  }

  public static normalizeDrawEssForRuntime(rawDrawEss: unknown): Record<string, unknown> {
    const drawEss = Plan._ensureObject(Plan._clone(rawDrawEss));
    const geoType = `${drawEss.SYM_GEO_TYPE ?? ''}`;

    if (drawEss.FLAP_ANGLE === undefined) drawEss.FLAP_ANGLE = 45;
    if (drawEss.BK_LN_DIST_RATIO === undefined) drawEss.BK_LN_DIST_RATIO = 5;
    if (drawEss.BK_LN_ANGL_RATIO === undefined) drawEss.BK_LN_ANGL_RATIO = 5;
    if (drawEss.FRNT_LN_ANGL_RATIO === undefined) drawEss.FRNT_LN_ANGL_RATIO = 0.8;
    if (drawEss.FRNT_LN_DIST_RATIO === undefined) drawEss.FRNT_LN_DIST_RATIO = 1.5;
    if (drawEss.FLAP_DIST_RATIO === undefined) drawEss.FLAP_DIST_RATIO = 3;

    drawEss.extraSettings = {
      ...Plan.LEGACY_EXTRA_SETTINGS_DEFAULT,
      ...Plan._ensureObject(drawEss.extraSettings),
    };

    const labelOptions = Plan._ensureObject(drawEss.labelOptions);
    const haloSize = Plan._toNumber(labelOptions.haloColorSize);
    const textSize = Plan._toNumber(labelOptions.textSize);
    if (haloSize !== undefined) labelOptions.haloColorSize = haloSize;
    if (textSize !== undefined) labelOptions.textSize = textSize;
    drawEss.labelOptions = labelOptions;

    if (geoType === 'Area') {
      const headRatio = Plan._toNumber(drawEss.HEAD_RATIO);
      const tailFactor = Plan._toNumber(drawEss.TAIL_FACTOR);
      if (headRatio !== undefined) drawEss.HEAD_RATIO = headRatio;
      if (tailFactor !== undefined) drawEss.TAIL_FACTOR = tailFactor;
      if (drawEss.DRAW_TYPE === undefined) drawEss.DRAW_TYPE = 1;
      if (drawEss.FACE_GAP === undefined) drawEss.FACE_GAP = 5;
      if (drawEss.drawExtendType === undefined) drawEss.drawExtendType = 1;
    }

    if (geoType === 'Point') {
      const amp = Plan._ensureObject(drawEss.AMPLIFIER);
      if (amp.TARGET_DESIGNATOR !== undefined) {
        drawEss.TARGET_DESIGNATOR = amp.TARGET_DESIGNATOR;
      }
    }

    if (geoType === 'FPoint') {
      const options = Plan._ensureObject(drawEss.OPTIONS);
      if (
        options.labelOptions === undefined ||
        typeof options.labelOptions !== 'object' ||
        Array.isArray(options.labelOptions)
      ) {
        options.labelOptions = Plan._clone(Plan.LEGACY_LABEL_OPTIONS_DEFAULT);
      }
      if (options.SYM_NAME === undefined) options.SYM_NAME = '';
      if (options.roa === undefined) options.roa = '';
      if (options.msn === undefined) options.msn = '';
      if (options.hfid === undefined) options.hfid = '';
      if (options.ph === undefined) options.ph = '';
      if (options.uniqueDesignationID === undefined) options.uniqueDesignationID = '';
      if (options.direction === undefined) options.direction = '';
      if (options.quantity === undefined) options.quantity = '';
      if (options.reinforcedReduced === undefined) options.reinforcedReduced = '';

      const amp = Plan._ensureObject(drawEss.AMPLIFIER);
      if (options.uniqueDesignation === undefined) {
        options.uniqueDesignation = typeof amp.UNIQUE_DESIG === 'string' ? amp.UNIQUE_DESIG.trim() : '';
      }
      if (options.higherFormation === undefined) {
        options.higherFormation = typeof amp.HIGHER_FORM === 'string' ? amp.HIGHER_FORM.trim() : '';
      }
      if (options.staffComments === undefined) {
        options.staffComments = typeof amp.STAFF_COM === 'string' ? amp.STAFF_COM.trim() : '';
      }
      if (options.additionalInformation === undefined) {
        options.additionalInformation = typeof amp.ADDL_INFO === 'string' ? amp.ADDL_INFO.trim() : '';
      }
      if (options.dtg === undefined && amp.DTG) {
        options.dtg = amp.DTG;
      }
      if (options.location === undefined && amp.LOC) {
        options.location = amp.LOC;
      }

      drawEss.OPTIONS = options;
    }

    drawEss.AMPLIFIER = Plan._ensureObject(drawEss.AMPLIFIER);
    return drawEss;
  }
}
