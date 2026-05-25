import symbolData from '../Data/Symbols.json';
import { parseSIDC, ParsedSIDC } from '../SIDC/SIDC';

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
  static getData(): any {
    return symbolData;
  }

  /** Lookup a symbol definition by its catalogue key. */
  static getByKey(key: string): any {
    return (symbolData as any)[key] || null;
  }

  /** Flat list suitable for autocomplete: { key, name } for every symbol. */
  static getNamesForAutocomplete(): Array<{ key: string; name: string }> {
    return Object.entries(symbolData).map(([key, data]: [string, any]) => ({
      key,
      name: data.Name || 'Unnamed Symbol',
    }));
  }

  /**
   * Parse the SIDC on `options.sidc` and enrich the object with parsedSIDC,
   * a human-readable label, and the echelon/mobility text. Returns the input
   * unchanged if the SIDC is missing or invalid.
   */
  static enrich<T extends SymbolOptionsLike>(
    options: T,
  ): T & { parsedSIDC?: ParsedSIDC; label?: string; text?: string } {
    try {
      if (!options.sidc) throw new Error('Missing SIDC in symbol options');

      console.log('SIDC:', options.sidc);
      const parsed = parseSIDC(options.sidc);
      console.log('Parsed SIDC:', parsed);
      console.log('Standard Identity', parsed.setA.standardIdentityLabel);
      console.log('Symbol Set', parsed.setA.symbolSetLabel);
      console.log('Echelon', parsed.setA.echelonMobilityLabel);

      return {
        ...options,
        parsedSIDC: parsed,
        label:
          `${parsed.setA.standardIdentityLabel ?? ''} ${parsed.setA.symbolSetLabel ?? ''}`.trim(),
        text: parsed.setA.echelonMobilityLabel ?? '',
      };
    } catch (error) {
      console.warn(error);
      console.warn('Invalid SIDC provided:', options.sidc);
      return options;
    }
  }
}
