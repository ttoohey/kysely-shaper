export type QuerySchemaType = {
  [P in string]: QuerySchemaType | null | [QuerySchemaType | null, unknown];
};

/**
 * Keys of S must exist in keys of T (recursive)
 */
export type PartialSchema<T, S> = S & {
  [P in keyof S]: P extends keyof T
    ? T[P] extends QuerySchemaType
      ? PartialSchema<T[P], S[P]>
      : T[P] extends [infer TP extends QuerySchemaType, infer TPArgs]
        ? S[P] extends [
            infer SP extends QuerySchemaType,
            infer SPArgs extends TPArgs,
          ]
          ? [PartialSchema<TP, SP>, SPArgs]
          : T[P]
        : T[P]
    : never;
};

export type Shaped<TSchema, TQuerySchema> =
  | Pick<TSchema, keyof TQuerySchema & keyof TSchema>
  | {
      [P in keyof TQuerySchema]: P extends keyof TSchema
        ? TSchema[P] extends Array<any>
          ? TQuerySchema[P] extends QuerySchemaType
            ? Shaped<TSchema[P][number], TQuerySchema[P]>[]
            : TQuerySchema[P] extends [
                  infer TP extends QuerySchemaType,
                  unknown,
                ]
              ? Shaped<TSchema[P][number], TP>[]
              : TSchema[P]
          : null extends TSchema[P]
            ? TQuerySchema[P] extends QuerySchemaType
              ? Shaped<NonNullable<TSchema[P]>, TQuerySchema[P]> | null
              : TSchema[P]
            : TQuerySchema[P] extends QuerySchemaType
              ? Shaped<TSchema[P], TQuerySchema[P]>
              : TSchema[P]
        : never;
    };

export type Resolver<TParent, TSchema, TQuerySchema extends QuerySchemaType> = {
  [P in keyof TQuerySchema]: P extends keyof TSchema
    ? TSchema[P] extends Array<any>
      ? TQuerySchema[P] extends QuerySchemaType
        ? (
            parent: TParent,
            shape: TQuerySchema[P],
          ) => Shaped<TSchema[P][number], TQuerySchema[P]>[]
        : (root: TParent, shape: TQuerySchema[P]) => TSchema[P]
      : null extends TSchema[P]
        ? (root: TParent) => TSchema[P]
        : TQuerySchema[P] extends QuerySchemaType
          ? (
              parent: TParent,
              shape: TQuerySchema[P],
            ) => Shaped<TSchema[P], TQuerySchema[P]>
          : TQuerySchema[P] extends [QuerySchemaType, infer TArgs]
            ? (
                parent: TParent,
                shape: TQuerySchema[P],
                args: TArgs,
              ) => Shaped<TSchema[P], TQuerySchema[P]>
            : TQuerySchema[P] extends [null, infer TArgs]
              ? (
                  parent: TParent,
                  shape: undefined,
                  args: TArgs,
                ) => Shaped<TSchema[P], TQuerySchema[P]>
              : (root: TParent) => TSchema[P]
    : never;
};
