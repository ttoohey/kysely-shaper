import { Expression, ExpressionBuilder, StringReference } from "kysely";
import { Shaped, QuerySchemaType } from "./shaper-types.js";

type ResolverArgs = { isAggregate: boolean };
type Resolver<T> = T | [T, ResolverArgs];

export type SelectResolvers<
  DB,
  TB extends keyof DB,
  TSchema,
  TQuerySchema extends QuerySchemaType,
  TContext = undefined,
> = {
  [P in keyof TQuerySchema]: P extends keyof TSchema
    ? TSchema[P] extends Array<any>
      ? TQuerySchema[P] extends QuerySchemaType
        ? Resolver<
            (
              eb: ExpressionBuilder<DB, TB>,
              shape: TQuerySchema[P],
              args: undefined,
              context: TContext,
              info: { propertyName: P },
            ) => Expression<Shaped<TSchema[P][number], TQuerySchema[P]>[]>
          >
        : TQuerySchema[P] extends [
              infer TShape extends QuerySchemaType,
              infer TArgs,
            ]
          ? Resolver<
              (
                eb: ExpressionBuilder<DB, TB>,
                shape: TShape,
                args: TArgs,
                context: TContext,
                info: { propertyName: P },
              ) => Expression<Shaped<TSchema[P][number], TShape>[]>
            >
          : TQuerySchema[P] extends [null, infer TArgs]
            ? Resolver<
                (
                  eb: ExpressionBuilder<DB, TB>,
                  shape: undefined,
                  args: TArgs,
                  context: TContext,
                  info: { propertyName: P },
                ) => Expression<TSchema[P]>
              >
            : never
      : null extends TQuerySchema[P]
        ?
            | Resolver<
                (
                  eb: ExpressionBuilder<DB, TB>,
                  shape: undefined,
                  args: undefined,
                  context: TContext,
                  info: { propertyName: P },
                ) => Expression<TSchema[P]>
              >
            | StringReference<DB, TB>
        : TQuerySchema[P] extends QuerySchemaType
          ? Resolver<
              (
                eb: ExpressionBuilder<DB, TB>,
                shape: TQuerySchema[P],
                args: undefined,
                context: TContext,
                info: { propertyName: P },
              ) => Expression<Shaped<
                NonNullable<TSchema[P]>,
                TQuerySchema[P]
              > | null>
            >
          : TQuerySchema[P] extends [QuerySchemaType, infer TArgs]
            ? Resolver<
                (
                  eb: ExpressionBuilder<DB, TB>,
                  shape: TQuerySchema[P][0],
                  args: TArgs,
                  context: TContext,
                  info: { propertyName: StringReference<DB, TB> },
                ) => Expression<Shaped<
                  NonNullable<TSchema[P]>,
                  TQuerySchema[P]
                > | null>
              >
            : TQuerySchema[P] extends [null, infer TArgs]
              ? Resolver<
                  (
                    eb: ExpressionBuilder<DB, TB>,
                    shape: undefined,
                    args: TArgs,
                    context: TContext,
                    info: { propertyName: P },
                  ) => Expression<Shaped<
                    NonNullable<TSchema[P]>,
                    TQuerySchema[P]
                  > | null>
                >
              : never
    : never;
};
