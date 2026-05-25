import { ParsedSIDC } from '../SIDC/SIDC';
export interface SymbolOptionsLike {
    sidc?: string;
    [key: string]: any;
}
/**
 * Stateless lookup and enrichment helpers backed by Symbols.json + SIDC parsing.
 * Extracted from SymbolEngine — SymbolEngine keeps getSymbolData / getSymbolByKey /
 * getSymbolNamesForAutocomplete / enrichSymbolOptions as thin delegates so existing
 * call sites are unchanged.
 */
export default class SymbolMetadataService {
    /** The complete symbol catalogue loaded from Symbols.json. */
    static getData(): any;
    /** Lookup a symbol definition by its catalogue key. */
    static getByKey(key: string): any;
    /** Flat list suitable for autocomplete: { key, name } for every symbol. */
    static getNamesForAutocomplete(): Array<{
        key: string;
        name: string;
    }>;
    /**
     * Parse the SIDC on `options.sidc` and enrich the object with parsedSIDC,
     * a human-readable label, and the echelon/mobility text. Returns the input
     * unchanged if the SIDC is missing or invalid.
     */
    static enrich<T extends SymbolOptionsLike>(options: T): T & {
        parsedSIDC?: ParsedSIDC;
        label?: string;
        text?: string;
    };
}
