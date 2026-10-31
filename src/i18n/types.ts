import type { en } from './en';
export type MessageKey = keyof typeof en;
export type PluralMessage = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;
export type Catalog = { [K in MessageKey]: (typeof en)[K] extends string ? string : PluralMessage };
type Slots<S extends string> = S extends `${string}{${infer P}}${infer Rest}` ? P | Slots<Rest> : never;
type Source<K extends MessageKey> = (typeof en)[K];
type Template<K extends MessageKey> =
  Source<K> extends string ? Source<K> : Source<K>[keyof Source<K>] & string;
export type Params<K extends MessageKey> = {
  [P in Slots<Template<K>>]: P extends 'count' ? number : string | number;
};
export type Args<K extends MessageKey> = keyof Params<K> extends never
  ? [params?: Params<K>]
  : [params: Params<K>];
export type Translate = <K extends MessageKey>(key: K, ...args: Args<K>) => string;
