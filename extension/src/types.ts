import { unknown } from "valibot";

export type HrefResponse = {
    href: typeof window.location.href;
    id: number;
};
export function isObject(obj: unknown): obj is object {
    return typeof obj === "object" && obj !== null;
}
export function hasKeys(
    obj: object,
    keys: string[],
): obj is {
    [k in (typeof keys)[number]]: unknown;
} {
    return keys.every((key) => key in obj);
}

export function isRecord(
    obj: unknown,
    keys: string[],
): obj is {
    [k in (typeof keys)[number]]: unknown;
} {
    return isObject(obj) && keys.every((key) => key in obj);
}
