import {
    StandardIdentities,
    SymbolSets,
    StatusCodes,
    HQTFDummyIndicators,
    EchelonMobilityAmplifiers,
    SymbolOptions
} from "../ThirdParty/MilSymbols/UEITypes.ts";

// --- Types ---

export interface SIDCSetA {
    version: string;
    standardIdentity: string;
    standardIdentityLabel?: string;
    symbolSet: string;
    symbolSetLabel?: string;
    status: string;
    statusLabel?: string;
    hqTaskForceDummy: string;
    hqTaskForceDummyLabel?: string;
    echelonMobility: string;
    echelonMobilityLabel?: string;
    entity: string;
}

export interface SIDCSetB {
    entityType: string;
    entitySubType: string;
    modifier1: string;
    modifier2: string;
    countryCode: string;
}

export interface SIDCSetC {
    symbologyOriginatorId: string;
    originatorSymbolSet: string;
    originatorExtension: string;
}

export interface ParsedSIDC {
    raw: string;
    setA: SIDCSetA;
    setB: SIDCSetB;
    setC?: SIDCSetC;
}

// --- Helpers ---

function safeLookup<T>(dict: Record<string, T> | undefined, key: string, fallback: T): T {
    if (!dict || typeof dict !== "object") return fallback;
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : fallback;
}

const getPart = (sidc: string, start: number, end: number): string => {
    if (sidc.length < end) throw new Error(`SIDC too short for slice ${start}-${end}`);
    return sidc.slice(start, end);
};

// --- Main Parser ---

export function parseSIDC(sidc: string): ParsedSIDC {
    if (!/^\d{30}$/.test(sidc)) {
        throw new Error("Invalid SIDC: must be exactly 30 numeric digits.");
    }

    // Log the actual values being extracted
    console.log("Standard Identity code:", sidc.slice(1, 2));
    console.log("Symbol Set code:", sidc.slice(2, 4));

    const symbolSet = sidc.slice(2, 4);

    // Extract echelon code based on format
    // For the specific format in the example "130310001812110000000000000000"
    // The echelon code is at positions 10-12 (18)
    let echelonCode;
    if (symbolSet === "03" || symbolSet === "10") {
        echelonCode = sidc.slice(10, 12);
        console.log("Echelon code (Land Unit format):", echelonCode);
    } else {
        echelonCode = sidc.slice(6, 8);
        console.log("Echelon code (standard format):", echelonCode);
    }

    // Extract entity type - for format "130310001812110000000000000000"
    // Entity type is at positions 12-14 (11 for Infantry)
    let entityType;
    if (symbolSet === "03" || symbolSet === "10") {
        entityType = sidc.slice(12, 14);
        console.log("Entity type (Land Unit format):", entityType);
    } else {
        entityType = sidc.slice(8, 10);
        console.log("Entity type (standard format):", entityType);
    }

    const setA: SIDCSetA = {
        version: getPart(sidc, 0, 1),
        standardIdentity: getPart(sidc, 1, 2),
        symbolSet: symbolSet,
        status: getPart(sidc, 4, 5),
        hqTaskForceDummy: getPart(sidc, 5, 6),
        echelonMobility: echelonCode, // Use the dynamically extracted echelon code
        entity: entityType,

        // Add debug logging for dictionary lookups
        standardIdentityLabel: (() => {
            const code = sidc.slice(1, 2);
            const label = StandardIdentities[code];
            console.log(`Looking up Standard Identity: code=${code}, found=${label}`);
            return label || "Unknown";
        })(),

        symbolSetLabel: (() => {
            const label = SymbolSets[symbolSet];
            console.log(`Looking up Symbol Set: code=${symbolSet}, found=${label}`);
            return label || "Unknown";
        })(),

        statusLabel: safeLookup(StatusCodes, sidc.slice(4, 5), "Unknown"),
        hqTaskForceDummyLabel: safeLookup(HQTFDummyIndicators, sidc.slice(5, 6), "Unknown"),
        echelonMobilityLabel: (() => {
            const label = EchelonMobilityAmplifiers[echelonCode];
            console.log(`Looking up Echelon: code=${echelonCode}, found=${label}`);
            return label || "Unknown";
        })()
    };

    // Adjust entity type position based on the format
    const setB: SIDCSetB = {
        entityType: entityType,
        entitySubType: symbolSet === "03" || symbolSet === "10" ? getPart(sidc, 14, 16) : getPart(sidc, 12, 14),
        modifier1: symbolSet === "03" || symbolSet === "10" ? getPart(sidc, 16, 18) : getPart(sidc, 14, 16),
        modifier2: symbolSet === "03" || symbolSet === "10" ? getPart(sidc, 18, 20) : getPart(sidc, 16, 18),
        countryCode: symbolSet === "03" || symbolSet === "10" ? getPart(sidc, 20, 22) : getPart(sidc, 18, 20),
    };

    const isSetCEmpty = sidc.slice(20) === "0000000000";

    const setC: SIDCSetC | undefined = isSetCEmpty
        ? undefined
        : {
            symbologyOriginatorId: symbolSet === "03" || symbolSet === "10" ? getPart(sidc, 22, 24) : getPart(sidc, 20, 22),
            originatorSymbolSet: symbolSet === "03" || symbolSet === "10" ? getPart(sidc, 24, 26) : getPart(sidc, 22, 24),
            originatorExtension: symbolSet === "03" || symbolSet === "10" ? getPart(sidc, 26, 30) : getPart(sidc, 24, 30),
        };

    return {
        raw: sidc,
        setA,
        setB,
        ...(setC ? { setC } : {}),
    };
}

// Function to enrich symbol options with parsed SIDC data
export function enrichSymbolOptions(options: SymbolOptions): SymbolOptions & {
    parsedSIDC?: ParsedSIDC;
    label?: string;
    text?: string;
} {
    try {
        if (!options.sidc) throw new Error("Missing SIDC in symbol options");

        console.log("SIDC:", options.sidc);
        const parsed = parseSIDC(options.sidc);
        console.log("Parsed SIDC:", parsed);
        console.log("Standard Identity", parsed.setA.standardIdentityLabel);
        console.log("Symbol Set", parsed.setA.symbolSetLabel);
        console.log("Echelon", parsed.setA.echelonMobilityLabel);

        return {
            ...options,
            parsedSIDC: parsed,
            label: `${parsed.setA.standardIdentityLabel ?? ""} ${parsed.setA.symbolSetLabel ?? ""}`.trim(),
            text: parsed.setA.echelonMobilityLabel ?? "",
        };
    } catch (error) {
        console.warn(error);
        console.warn("Invalid SIDC provided:", options.sidc);
        return options;
    }
}
