import { SelectQueryBuilder } from "kysely";
import { SelectResolvers } from "./select-resolvers.js";
import { PartialSchema, Shaped, QuerySchemaType } from "./shaper-types.js";
import { ExpressionBuilder } from "kysely";

export function createSelectExpressionShaper<
  Schema,
  QuerySchema extends QuerySchemaType,
  DB,
  TB extends keyof DB,
  TContext,
>(
  resolvers: SelectResolvers<DB, TB, Schema, QuerySchema, TContext>,
  context?: TContext,
) {
  return <TQuerySchema extends Partial<QuerySchema>>(
      shape: PartialSchema<QuerySchema, TQuerySchema>,
    ) =>
    <O>(query: SelectQueryBuilder<DB, TB, O>) => {
      const keys = Object.keys(shape);
      const entries = Object.entries(resolvers).filter(([key]) =>
        keys.includes(key),
      );
      const nonAggregateEntries = entries
        .filter(
          ([_key, resolver]) =>
            !Array.isArray(resolver) || !resolver[1].isAggregate,
        )
        .map(([key]) => key as any);
      const hasAggregate = entries.some(
        ([_key, resolver]) =>
          Array.isArray(resolver) && resolver[1].isAggregate,
      );

      return query
        .select((eb) =>
          entries
            .map(([key, resolver]) =>
              (Array.isArray(resolver)
                ? ((resolver = resolver[0]), true)
                : true) && typeof resolver === "function"
                ? [key, resolver]
                : [key, (eb: ExpressionBuilder<DB, TB>) => eb.ref(resolver)],
            )
            .map(([key, resolver]) =>
              Array.isArray(shape[key])
                ? resolver(eb, shape[key][0], shape[key][1], context, {
                    propertyName: key,
                  }).as(key)
                : null === shape[key]
                  ? resolver(eb, undefined, undefined, context, {
                      propertyName: key,
                    }).as(key)
                  : resolver(eb, shape[key], undefined, context, {
                      propertyName: key,
                    }).as(key),
            ),
        )
        .$if(hasAggregate && nonAggregateEntries.length > 0, (qb) =>
          qb.groupBy(nonAggregateEntries),
        )
        .$castTo<O & Shaped<Schema, TQuerySchema>>();
    };
}
