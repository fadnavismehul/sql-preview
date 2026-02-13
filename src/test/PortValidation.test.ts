import { validatePort } from '../utils/validation';

describe('validatePort', () => {
    test('should accept valid ports as numbers', () => {
        expect(validatePort(80)).toBe(80);
        expect(validatePort(8080)).toBe(8080);
        expect(validatePort(65535)).toBe(65535);
        expect(validatePort(1)).toBe(1);
    });

    test('should accept valid ports as strings', () => {
        expect(validatePort("80")).toBe(80);
        expect(validatePort(" 8080 ")).toBe(8080);
        expect(validatePort("65535")).toBe(65535);
    });

    test('should reject invalid numbers', () => {
        expect(() => validatePort(0)).toThrow('Port out of range');
        expect(() => validatePort(-1)).toThrow('Port out of range');
        expect(() => validatePort(65536)).toThrow('Port out of range');
        expect(() => validatePort(1.5)).toThrow('Port must be an integer');
        expect(() => validatePort(NaN)).toThrow('Port must be an integer');
        expect(() => validatePort(Infinity)).toThrow('Port must be an integer');
    });

    test('should reject invalid strings', () => {
        expect(() => validatePort("abc")).toThrow('Invalid port format');
        expect(() => validatePort("80@evil.com")).toThrow('Invalid port format');
        expect(() => validatePort("80/foo")).toThrow('Invalid port format');
        expect(() => validatePort("")).toThrow('Invalid port format');
        expect(() => validatePort("  ")).toThrow('Invalid port format');
        expect(() => validatePort("12.34")).toThrow('Invalid port format'); // regex `^\d+$` handles only integers
    });

    test('should reject other types', () => {
        expect(() => validatePort(null)).toThrow('Invalid port type');
        expect(() => validatePort(undefined)).toThrow('Invalid port type');
        expect(() => validatePort({})).toThrow('Invalid port type');
        expect(() => validatePort([])).toThrow('Invalid port type');
    });
});
