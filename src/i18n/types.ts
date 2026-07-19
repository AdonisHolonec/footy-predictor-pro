export type Locale = "ro" | "en";

export type Dict = { [key: string]: string | Dict };

export type TranslateFn = (key: string, params?: Record<string, string | number>) => string;
