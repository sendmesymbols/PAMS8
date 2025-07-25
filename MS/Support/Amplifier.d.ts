/**
 * Amplifier class for military symbology
 * Handles symbol amplification and additional information display
 */
export declare class Amplifier {
    SYMBOL_ICON: string;
    ECHELON: string;
    QUANTITY: string;
    HOSTILE: string;
    DIR_OF_MOV_INDICATOR: string;
    OFFSET_LOC_INDICATOR: string;
    UNIQUE_DESIG: string;
    TYPE: string;
    DTG: string;
    EDTG: string;
    SIZE?: number;
    /**
     * An alphanumeric designator for displaying a date-time group (DDHHMMSSZMONYYYY)
     * or "O/O" for on order. The date-time group is composed of a group of six numeric
     * digits with a time zone suffix and the standardized three-letter abbreviation for
     * the month followed by four digits. The first pair of digits represents the day,
     * the second pair, the hour, the third pair, the minutes. The last four digits after
     * the month are the year. For automated systems, two digits may be added before the
     * time zone suffix and after the minutes to designate seconds.
     */
    ALTITUDE_DEPTH: string;
    SIDC: string;
    LOC: string;
    DISTANCE: string;
    AZIMUTH: string;
    TARGET_DESIGNATOR: string;
    COUNTRY: string;
    HIGHER_FORM: string;
    STAFF_COM: string;
    ADDL_INFO: string;
    constructor(sidc?: string, options?: Partial<Amplifier>);
    /**
     * Reset all properties to default values
     */
    reset(): void;
    /**
     * Clone the current Amplifier instance
     */
    clone(): Amplifier;
    /**
     * Check if the amplifier has any meaningful data
     */
    hasData(): boolean;
    /**
     * Get all non-empty properties as an object
     */
    getNonEmptyProperties(): Record<string, string>;
    /**
     * Set multiple properties at once
     */
    setProperties(properties: Partial<Amplifier>): void;
    getEchelon(sidc: string): string;
    /**
     * Get a formatted string representation of the amplifier data
     */
    toString(): string;
}
export default Amplifier;
