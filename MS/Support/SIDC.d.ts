import Color from "@arcgis/core/Color";
import SimpleMarkerSymbol from "@arcgis/core/symbols/SimpleMarkerSymbol";
import SimpleLineSymbol from "@arcgis/core/symbols/SimpleLineSymbol";
import SimpleFillSymbol from "@arcgis/core/symbols/SimpleFillSymbol";
/**
 * Interface for standard identity configuration
 */
interface StandardIdentityConfig {
    Style: string;
    Color: Color;
}
/**
 * SIDC (Symbol Identification Coding Scheme) class for military symbology
 * Handles SIDC parsing, validation, and symbol generation
 */
export declare class SIDC {
    private _sidc;
    symbolThickness: number;
    standardIdentities: StandardIdentityConfig[][];
    constructor(sidc: string);
    /**
     * Validate SIDC format
     * @param sidc The SIDC string to validate
     * @returns True if SIDC is valid (20 characters)
     */
    validateSIDC(sidc: string): boolean;
    /**
     * Get the SID (Symbol Identification) part of the SIDC
     * @returns SID substring (positions 10-16)
     */
    getSID(): string;
    /**
     * Get the identity part of the SIDC
     * @returns Identity substring (positions 2-4)
     */
    getIdentity(): string;
    /**
     * Get the status from the SIDC
     * @returns Status character (position 6)
     */
    getStatus(): string;
    /**
     * Get the complete SIDC string
     * @returns The full SIDC string
     */
    getSIDC(): string;
    /**
     * Get the height setting
     * @returns Height value from settings
     */
    getHeight(): number;
    /**
     * Get the width setting
     * @returns Width value from settings
     */
    getWidth(): number;
    /**
     * Generate a marker symbol based on SIDC and parameters
     * @param symGeometricType The geometric type (Point, Line, Area)
     * @param isObs Whether this is an obstacle (optional)
     * @param fill Whether to fill the symbol (optional)
     * @returns The generated symbol
     */
    getMarker(symGeometricType: string, isObs?: string, fill?: string): SimpleMarkerSymbol | SimpleLineSymbol | SimpleFillSymbol;
    /**
     * Set a new SIDC value
     * @param sidc The new SIDC string
     */
    setSIDC(sidc: string): void;
    /**
     * Get the identity index as a number
     * @returns The identity index
     */
    getIdentityIndex(): number;
    /**
     * Check if the SIDC represents a pending status
     * @returns True if status is pending
     */
    isPending(): boolean;
    /**
     * Get the color for the current identity
     * @returns The color for the current identity
     */
    getIdentityColor(): Color;
}
export default SIDC;
