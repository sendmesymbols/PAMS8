"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const Plan_1 = __importDefault(require("./Plan"));
// Test data representing different geometry types
const testCases = [
    {
        name: 'Point geometry with missing OFFSET',
        input: {
            SYM_GEO_TYPE: 'Point',
            SID: '160303',
            SYM_NAME: 'Tgt',
            SIZE: 70,
            ANGLE: 0,
            GEOM: { type: 'point', x: 73.73, y: 33.23, sp: 'WGS1SP' },
            AMPLIFIER: {},
            SIDC: '10062500181603030000',
            labelOptions: { haloColorSize: 5, textSize: 20 },
            opacity: 1,
        },
        expectedFields: {
            OFFSET: '0',
            ISFHAND: 0,
            FRHNDSZ: 0,
            FRHNDWDTH: 0,
        },
        expectedTypes: {
            'labelOptions.haloColorSize': 'string',
            'labelOptions.textSize': 'string',
        },
    },
    {
        name: 'Area geometry with missing drawExtendType and wrong types',
        input: {
            SYM_GEO_TYPE: 'Area',
            SID: '151403',
            SYM_NAME: 'Main Attk',
            CTRL_PTS: [
                { type: 'point', x: 61.10, y: 31.93, sp: 'WGS1SP' },
                { type: 'point', x: 61.91, y: 30.65, sp: 'WGS1SP' },
            ],
            AMPLIFIER: {},
            ECHELON: '',
            HEAD_RATIO: 0.07,
            TAIL_FACTOR: 0.05,
            SIDC: '10062500181514030000',
            labelOptions: {},
            opacity: 1,
        },
        expectedFields: {
            DRAW_TYPE: 1,
            FACE_GAP: 5,
            drawExtendType: 1,
        },
        expectedTypes: {
            HEAD_RATIO: 'string',
            TAIL_FACTOR: 'string',
        },
        expectedAmplifierFields: {
            DTG: '',
            DTGTO: '',
            ph: '',
        },
    },
    {
        name: 'Line geometry with missing drawExtendType',
        input: {
            SYM_GEO_TYPE: 'Line',
            SID: '140303',
            SYM_NAME: 'Start Line',
            CTRL_PTS: [
                { type: 'point', x: 74.63, y: 32.32, sp: 'WGS1SP' },
                { type: 'point', x: 74.63, y: 32.32, sp: 'WGS1SP' },
            ],
            AMPLIFIER: {},
            SIDC: '10032500001403030000',
            labelOptions: {},
            opacity: 1,
        },
        expectedFields: {
            DRAW_TYPE: 1,
            drawExtendType: 1,
            ISFHAND: 0,
            FRHNDSZ: 0,
            FRHNDWDTH: 0,
        },
    },
    {
        name: 'FPoint geometry with labelOptions as 0',
        input: {
            SYM_GEO_TYPE: 'FPoint',
            SID: '121100',
            SYM_NAME: 'Inf',
            OPTIONS: {
                alphaNum: 100,
                size: 20,
                ANGLE: 0,
                symType: 'FPoint',
                SIDC: '10061000181211000000',
                uniqueDesignation: 'Test',
                uniqueDesignationID: '',
                higherFormation: 'Test Formation',
                hfid: '',
                staffComments: '',
                additionalInformation: '',
                ECHELON: '18',
                opacity: 1,
                labelOptions: 0, // This should be converted to an object
                GEOM: { type: 'point', x: 62.11, y: 32.98, sp: 'WGS1SP' },
            },
            GEOM: { type: 'point', x: 62.11, y: 32.98, sp: 'WGS1SP' },
            AMPLIFIER: {},
            UEI: '1',
            SIDC: '10061000181211000000',
            labelOptions: {},
            opacity: 1,
        },
        expectedOptionsFields: {
            msn: '',
            ph: '',
            roa: '',
        },
        expectedOptionsTypes: {
            size: 'string',
            labelOptions: 'object',
        },
    },
];
console.log('Testing Plan.normalizeDrawEssForLegacyExport...\n');
let passedTests = 0;
let failedTests = 0;
testCases.forEach((testCase) => {
    console.log(`Test: ${testCase.name}`);
    try {
        const result = Plan_1.default.normalizeDrawEssForLegacyExport(testCase.input);
        // Check expected fields
        if (testCase.expectedFields) {
            for (const [field, expectedValue] of Object.entries(testCase.expectedFields)) {
                if (result[field] !== expectedValue) {
                    console.log(`  ❌ FAIL: Expected ${field} to be ${expectedValue}, got ${result[field]}`);
                    failedTests++;
                    return;
                }
            }
        }
        // Check expected types
        if (testCase.expectedTypes) {
            for (const [path, expectedType] of Object.entries(testCase.expectedTypes)) {
                const parts = path.split('.');
                let value = result;
                for (const part of parts) {
                    value = value?.[part];
                }
                const actualType = typeof value;
                if (actualType !== expectedType) {
                    console.log(`  ❌ FAIL: Expected ${path} to be type ${expectedType}, got ${actualType}`);
                    failedTests++;
                    return;
                }
            }
        }
        // Check expected AMPLIFIER fields
        if (testCase.expectedAmplifierFields) {
            const amplifier = result.AMPLIFIER;
            for (const [field, expectedValue] of Object.entries(testCase.expectedAmplifierFields)) {
                if (amplifier[field] !== expectedValue) {
                    console.log(`  ❌ FAIL: Expected AMPLIFIER.${field} to be "${expectedValue}", got "${amplifier[field]}"`);
                    failedTests++;
                    return;
                }
            }
        }
        // Check expected OPTIONS fields
        if (testCase.expectedOptionsFields) {
            const options = result.OPTIONS;
            for (const [field, expectedValue] of Object.entries(testCase.expectedOptionsFields)) {
                if (options[field] !== expectedValue) {
                    console.log(`  ❌ FAIL: Expected OPTIONS.${field} to be "${expectedValue}", got "${options[field]}"`);
                    failedTests++;
                    return;
                }
            }
        }
        // Check expected OPTIONS types
        if (testCase.expectedOptionsTypes) {
            const options = result.OPTIONS;
            for (const [field, expectedType] of Object.entries(testCase.expectedOptionsTypes)) {
                const actualType = typeof options[field];
                if (actualType !== expectedType) {
                    console.log(`  ❌ FAIL: Expected OPTIONS.${field} to be type ${expectedType}, got ${actualType}`);
                    failedTests++;
                    return;
                }
            }
        }
        // Check common default fields
        const commonDefaults = {
            FLAP_ANGLE: 45,
            BK_LN_DIST_RATIO: 5,
            BK_LN_ANGL_RATIO: 5,
            FRNT_LN_ANGL_RATIO: 0.8,
            FRNT_LN_DIST_RATIO: 1.5,
            FLAP_DIST_RATIO: 3,
        };
        for (const [field, expectedValue] of Object.entries(commonDefaults)) {
            if (result[field] !== expectedValue) {
                console.log(`  ❌ FAIL: Expected ${field} to be ${expectedValue}, got ${result[field]}`);
                failedTests++;
                return;
            }
        }
        console.log('  ✅ PASS');
        passedTests++;
    }
    catch (error) {
        console.log(`  ❌ FAIL: ${error}`);
        failedTests++;
    }
    console.log('');
});
console.log(`\nTest Results: ${passedTests} passed, ${failedTests} failed`);
if (failedTests === 0) {
    console.log('\n✅ All tests passed! The fix is working correctly.');
    process.exit(0);
}
else {
    console.log('\n❌ Some tests failed. Please review the implementation.');
    process.exit(1);
}
