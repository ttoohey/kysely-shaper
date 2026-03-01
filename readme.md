# kysely-shaper

Helper for [kysely](https://kysely.dev/) to create a composable, type-safe, SQL query builder.

## Why?

We want to be able to build composable queries that select just what we need from the database without creating repositories of repeated code.

A strategy for building a complex application is to start with just what is needed and extend when new requirements arrive. Following a repository pattern we may create a function like:

```ts
// person-repository.ts
export async function findPersonById(id: number) {
  return await db
    .selectFrom("person")
    .selectAll()
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}
```

This can be a very useful function to the application, since the response has everything from the database table.

```ts
const person = await findPersonById(personId);
doSomething(person);
doSomethingElse(person);
```

But as things get more complicated we find we need more nuanced respository functions.

```ts
export async function findPersonByIdWIthPets(id: number) {}
export async function findPersonByIdWithFullName(id: number) {}
```

We can end up with a plethora of functions. It's because in different parts of the application we have different reasons for "finding a person record". Sometimes we just want all the fields, but often we don't.

The alternative might be to return all the extensions, like "with pets" and "with full name", in the one function. Getting that data can be less efficient so it's desired to only get it if it's required. We might add conditional parameters to the function and make the function build a query with only the extensions that have been requested.

```ts
type FindPersonExtensions = { withPets: boolean; withFullName: boolean };
export async function findPersonById(
  id: number,
  extensions: FindPersonExtensions,
) {}
```

Implementing this can be fiddly. What if we want to get pets but we want some extra details of pets? How can we get Typescript to understand that the response doesn't always contain the extensions?

This is what `kysely-shaper` is helping to solve. It helps us get just what we need in an efficient way, while keeping the Typescript and auto-completion features of `kysely`?

## How to use

In the following example we define the `Database` type in the of way `kysely`:

```ts
// types.ts
import { Generated } from "kysely";

// see https://kysely.dev/docs/getting-started for an explanation
export interface Database {
  person: PersonTable;
  pet: PetTable;
}

interface PersonTable {
  id: Generated<number>;
  first_name: string;
  last_name: string;
}

interface PetTable {
  id: Generated<number>;
  name: string;
  species: string;
  owner_id: number;
}
```

Now we define types that describe the shape of database responses, and types that describe how to request the shape.

The _resolvers_ define how to get the data for each field in the shape.

`kysely-shaper` exports a `createSelectExpressionShaper` function that is used to create "shaper" functions that are usable in a `db.selectFrom().$call()` expression.

```ts
// person-repository.ts
import { createSelectExpressionShaper, SelectResolvers } from "kysely-shaper";
import { Database } from "./types.js";

export type PersonSchema = {
  id: number;
  first_name: string;
  last_name: string;
};

export type PersonQuerySchema = {
  id: null;
  first_name: null;
  last_name: null;
};

const personResolvers: SelectResolvers<
  Database,
  "person",
  PersonSchema,
  PersonQuerySchema
> = {
  id: "person.id",
  first_name: "person.first_name",
  last_name: "person.last_name",
};

export const shapeOfPerson = createSelectExpressionShaper(personResolvers);
```

Similarly for the `pet` table, but this time showing how a relationship may be implemented to _compose_ the shape of the pet's owner.

```ts
// pet-repository.ts
import { createSelectExpressionShaper, SelectResolvers } from "kysely-shaper";
import { Expression } from "kysely";
import { jsonObjectFrom } from "kysely/helpers/postgres";
import { Database } from "./types.js";
import {
  shapeOfPerson,
  PersonSchema,
  PersonQuerySchema,
} from "./person-repository.js";

export type PetSchema = {
  id: number;
  name: string;
  species: string;
  owner: PersonSchema; // 👈 composable schema
};

export type PetQuerySchema = {
  id: null;
  name: null;
  species: null;
  owner: Partial<PersonQuerySchema>;
};

// see https://kysely.dev/docs/recipes/relations for an explantion of this helper
function person(
  personId: Expression<number>,
  shape: Partial<PersonQuerySchema>,
) {
  return jsonObjectFrom(
    db
      .selectFrom("person")
      .$call(shapeOfPerson(shape))
      .where("person.id", "=", personId),
  );
}

const petResolvers: SelectResolvers<
  Database,
  "pet",
  PetSchema,
  PetQuerySchema
> = {
  id: "pet.id",
  name: "pet.name",
  species: "pet.species",
  // 👇 a composable child object
  owner: (eb, shape) => person(eb.ref("pet.owner_id", shape)),
};

export const shapeOfPet = createSelectExpressionShaper(petResolvers);
```

Whew.

That's the setup. Now we get to make _shaped_ queries by using the `shapeOfPerson()` and `shapeOfPet()` functions in appropriate database select expressions.

```ts
const person = await db
  .selectFrom("person")
  .$call(
    shapeOfPerson({
      id: null,
      first_name: null,
    }),
  )
  .executeTakeFirst();
// person: { id: number, first_name: string }

person.id; // number
person.first_name; // string
person.last_name; // ❌ Property 'last_name' does not exist on type

const pet = await db
  .selectFrom("pet")
  .$call(
    shapeOfPet({
      name: null,
      owner: {
        first_name: null,
        last_name: null,
      },
    }),
  )
  .executeTakeFirst();
// pet: { name: string, owner: { first_name: string, last_name: string }}

pet.id; // ❌ Property 'id' does not exist on type
pet.name; // string
pet.owner.first_name; // string
pet.owner.last_name; // string
```

A pattern to follow is to add functions to the repository scripts that simplify the request a little:

```ts
// person-repository.ts

export async function findPersonById(
  id: number,
  shape: Partial<PersonQuerySchema>,
) {
  return await db
    .selectFrom("person")
    .$call(shapeOfPerson(shape))
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
}

export async function findPerson(
  criteria: { first_name?: string; last_name?: string },
  shape: Partial<PersonQuerySchema>,
) {
  return await db
    .selectFrom("person")
    .$call(shapeOfPerson(shape))
    .$if(criteria.first_name, (qb) =>
      qb.where("first_name", "=", criteria.first_name!),
    )
    .$if(criteria.last_name, (qb) =>
      qb.where("last_name", "=", criteria.last_name!),
    )
    .execute();
}
```

And now they may be used:

```ts
const person = await findPersonById(123, { last_name: null });

const personsNamedArnold = await findPerson(
  { first_name: "Arnold" },
  { first_name: null, last_name: null },
);
```

If we have a new requirement we can update the `Schema`, `QuerySchema`, and `resolvers` to include new fields. They will only be used in places where we need them.

## Key concepts

### Schema types

In `kysely` we define `Table` types that describes the structure of records in the database tables. Using the `Selectable`, `Insertable`, and `Updateable` we can derive types that are useful to query building.

```ts
export type Person = Selectable<PersonTable>;
export type NewPerson = Insertable<PersonTable>;
export type PersonUpdate = Updateable<PersonTable>;
```

We abstract this a little further so that we can talk about shapes of query responses that aren't strictly the structure of the records in the database tables, but are meeting the needs of the application. This allows us to refer to, for example, a nested object composed of related records. Or to refer to a computed value (eg, `totalCost = quantity * cost`).

A schema type may be (or start out as) a one-to-one mapping of the `Selectable` type.

```ts
export type PersonSchema = Person;
// becomes
export type PersonSchema = Omit<Person, "private_field">;
// and later
export type PersonSchema = Omit<Person, "private_field"> & {
  full_name: string;
  pets: PetSchema[];
};
```

Creating a single `Schema` type for each object in the application encourages re-use and more thoughtful definitions of the application logic. Instead of developers re-inventing a "total cost" calculation and having various permutations of it's name they can extend the schema once and re-use it as needed.

### QuerySchema types

The `QuerySchema` type defines how a "shape" object will look to query the database to return a shape.

The keys of the `QuerySchema` must match the keys of the corresponding `Schema`.

The `QuerySchema` type is defined as:

```ts
type QuerySchema = {
  [P in string]: null | QuerySchema | [null | QuerySchema, unknown];
};
```

A `null` represents a "Scalar" property, meaning it's not an object. These are strings, numbers, booleans, etc.

A `QuerySchema` means it's a nested object. This allows composable shapes.

The tuple form allows passing arguments to resolvers. An example use case for this is when we want to get a list of related records, but provide a criteria to select only some of them.

```ts
const personWithDogs = await findPersonById(123, {
    first_name: null; // getting a Scalar value
    pets: [
        { id: null, name: null }, // getting an Object value (shape of pets)
        { species: 'dog' }, // criteria to find only dogs
    ]
});
```

The `QuerySchema` to allow for this would look like:

```ts
type PersonQuerySchema = {
  first_name: null; // a Scalar with no arguments
  pets: [
    Partial<PetQuerySchema>, // the QuerySchema for shaping pets
    { species?: string }, // a criteria type for filtering the "pets" table
  ];
};
```

> [!TIP]
>
> `pets` isn't a array because we've used the tuple structure. It's an array because we've defined it as one in the `PersonSchema` type.

### Select resolvers

The resolvers object that we define for each schema type is how we get to a concrete value (or a concrete SQL query builder expression).

The resolver is defined with a type using the `SelectResolver` utility type.

```ts
const resolver: SelectResolver<DB, TB, Schema, QuerySchema> = {
  //
};
```

The keys of the resolver must match the keys of the `Schema` type (and also the `QuerySchema` since both must have the same keys).

The values of the resolver are either:

- A `StringExpression`, or
- A callback function to return a `SelectWrapper`

These are the same as would be written in `kysely` for a query builder `.select()` expression like:

```ts
db.selectFrom("person").select([
  // example of a string expression
  "person.id",
  // example of a callback
  (eb) =>
    sql<string>`concat(${eb.ref("first_name")}, ' ', ${eb.ref("last_name")})`.as(
      "full_name",
    ),
]);
```

The resolver may use the simple string expressions (like "id" or "person.id"), and Typescript will show an error if they don't match the table type (`PersonTable`). When using the function callback for a field it has the following signature:

```ts
// somewhat simplified to get the concept
type TResolverCallback<DB, TB, Schema, QuerySchema> = {
    // for Scalar fields
    [P in keyof Schema]: (eb: ExpressionBuilder<DB, TB>): Schema[P]
    // for Object fields
    [P in keyof Schema]: (eb: ExpressionBuilder<DB, TB>, shape: QuerySchema[P]): Schema[P]
    // for Scalar fields with arguments
    [P in keyof Schema]: (eb: ExpressionBuilder<DB, TB>, _shape: null, args: QuerySchema[P][1]): Schema[P]
    // for Object fields with arguments
    [P in keyof Schema]: (eb: ExpressionBuilder<DB, TB>, shape: QuerySchema[P][0], args: QuerySchema[P][1]): Schema[P]
}
```

> [!WARNING]
>
> The above is roughly what the function signature is. I've simplified it here to try to focus on the concepts. For example, the callbacks don't actually return `Schema[P]` like that; they return select builder expressions.

Example:

```ts
const resolvers: SelectResolvers<
  Database,
  "person",
  PersonSchema,
  PersonQuerySchema
> = {
  id: "id",
  last_name: "person.last_name",
  full_name: (eb) =>
    sql<string>`concat(${eb.ref("first_name")}, ' ', ${eb.ref("last_name")})`,
};
```

The `resolvers` object is passed to the `createSelectExpressionShaper()` function to create a function that is used to setup a query builder.

```ts
const shapeOfPerson = createSelectExpressionShaper(resolvers);
db.selectFrom("person").$call(shapeOfPerson({ id: null, full_name: null }));
// select "id", concat("first_name", ' ', "last_name") as "full_name" from "person";
```

### Composable relationships

The `Schema` types allow defining complex data structures with relationships.

```ts
type PersonSchema {
    // "has many" relationship to Pet
    pets: PetSchema[]
}

type PetSchema {
    // "belongs to" relationship to Person
    owner: PersonSchema
}
```

The `QuerySchema` continues this relationship.

```ts
type PersonQuerySchema {
    pets: Partial<PetQuerySchema>
}

type PetQuerySchema {
    owner: Partial<PersonQuerySchema>
}
```

So you could make a deeply nested shape:

```ts
const shape = {
  pets: {
    owner: {
      pets: {
        owner: {
          pets: {},
        },
      },
    },
  },
} satisfies Partial<PersonQuerySchema>;
```

Resolvers are also composable.

```ts
const personResolvers = {
  pets: (eb, shape) =>
    jsonArrayFrom(
      db
        .selectFrom("pet")
        // 👇 composing 👇
        .$call(shapeOfPet(shape))
        .where("owner_id", "=", eb.ref("person.id")),
    ),
};

const shapeOfPerson = createSelectExpressionShaper(personResolvers);

const petResolvers = {
  owner: (eb, shape) =>
    jsonObjectFrom(
      db
        .selectFrom("person")
        // 👇 composing 👇
        .$call(shapeOfPerson(shape))
        .where("id", "=", eb.ref("owner_id")),
    ),
};
const shapeOfPet = createSelectExpressionShaper(petResolvers);
```

### JSONified responses

Often we find that our `Schema` is composed of related types.

```ts
type PersonSchema = {
  pets: PetSchema[];
};
```

The resolver for the `pets` property will typically involve using `jsonArrayFrom` function. See https://kysely.dev/docs/recipes/relations for an explanation of this.

Consider if the `pet` table has columns that don't fit nicely into a JSON object. For example, it has a `Date` field.

```ts
type PetSchema = {
  birth_date: Date;
};
```

When we build and execute a query like:

```ts
function pet(ownerId: Expression<number>) {
  return jsonArrayFrom(
    db.selectFrom("pet").selectAll().where("owner_id", "=", ownerId),
  );
}

const personWithPets = await db
  .selectFrom("person")
  .select([(eb) => pet(eb.ref("person.id")).as("pets")])
  .executeTakeFirst();
```

The type of `personWithPets` ends up as:

```ts
type PersonWithPets = { pets: { birth_date: string }[] };
```

instead of the expected result:

```ts
type PersonWithPets = { pets: { birth_date: Date }[] }; // ❌
```

This is because `date` and `timestamp` columns in the database are coerced to strings for the JSONification of the response. There's no getting around this. The `JSON_AGG()` database function used to get child objects has little choice.

Other primitive database types are coerced to strings also. For example, the `bigint` type.

To account for this we wrap child types with the `JsonFrom` utility type which makes the schema match the reality.

```ts
import { JsonFrom } from "kysely-shaper";

type PersonSchema = {
  pets: JsonFrom<PetSchema>[];
};

type PetSchema = {
  owner: JsonFrom<PersonSchema>;
};
```

Now when we execute queries Typescript is reporting the actual type of the data, and not just the wishful thinking version.

```ts
const person = await findPersonById(123, {
  pets: { id: null, birth_date: null },
});
const pet = await findPetById(person.pets[0].id, { birth_date: null });

person.pets[0].birth_date; // string
pet.birth_date; // Date
```

Transformation of database responses to "de-json-ify" them is beyond the scope of this package.

### Fields with arguments

While it's common for fields to be simple values, or simple derived values, sometimes we have a need to pass arguments to the shaper functions.

For example (somewhat contrived):

```ts
type PaymentSchema = {
  amount: number;
  computedTax: number;
  totalAmount: number;
};
```

where `computedTax` and `totalAmount` aren't being stored, but are instead calculated at query execution time. We can pass a `taxRate` as an argument to calculate them.

```ts
type PaymentQuerySchema = {
  amount: null;
  computedTax: [null, number];
  totalAmount: [null, number];
};
```

The `amount` field has no arguments, but `computedTax` and `totalAmount` have an argument with type `number`. All of them are scalar values.

The resolvers object for this example might look like:

```ts
const resolvers: SelectResolvers<
  Database,
  "payment",
  PaymentSchema,
  PaymentQuerySchema
> = {
  amount: "payment.amount",
  computedTax: (eb, _shape, taxRate) =>
    sql<number>`${eb.ref("payment.amount")} * ${eb.lit(taxRate)}`,
  totalAmount: (eb, _shape, taxRate) =>
    sql<number>`${eb.ref("payment.amount")} * ${eb.lit(1 + taxRate)}`,
};
```

```ts
const payment = await findPaymentById(123, {
  amount: null,
  computedTax: [null, 0.1],
  totalAmount: [null, 0.1],
});
// payment: { amount: 95, computedTax: 9.5, totalAmount: 104.5 }
```

A more common use case for resolver arguments is to define criteria for child object relationships.

```ts
type PersonQuerySchema = {
  pets: [Partial<PetQuerySchema>, PetCriteria];
};

const resolvers: SelectResolvers<Database, "pet", PetSchema, PetQuerySchema> = {
  pets: (eb, shape, criteria) => pets(eb.ref("person.id"), shape, criteria),
};
```

Now when we get a person with pets, a `criteria` object of type `PetCriteria` is required.

```ts
const personWithPets = await findPersonById(123, {
  pets: [{ id: null, name: null }, { species: "dog" }],
});
```

### Aggregates

We can include aggregate values in our `Schema` types. For example, consider the `Person` schema

```ts
type PersonSchema {
    gender: 'male' | 'female' | 'other' | null
    count: number
}

type PersonQuerySchema {
    gender: null;
    count: null;
}
```

The resolver for `count` will be use an aggregate expression. To mark this the resolvers object uses a tuple for the `count` field.

```ts
// conceptual type for resolver properties
type TResolver =
  | StringExpression
  | TResolverCallback
  | [TResolverCallback, { isAggregate: boolean }];
```

```ts
const resolvers: SelectResolvers<
  Database,
  "person",
  PersonSchema,
  PersonQuerySchema
> = {
  gender: "person.gender",
  count: [(eb) => eb.fn.countAll(), { isAggregate: true }],
};

const shapeOfPerson = createSelectExpressionShaper(resolvers);
```

Now when `shapeOfPerson` is used with a `count` property in the shape object, an aggregate database query is performed.

```ts
const { count } = await db
  .selectFrom("person")
  .$call(shapeOfPerson({ count: null }))
  .executeTakeFirstOrThrow();
// count is the total number of 'person' records

const personCountByGender = await db
  .selectFrom("person")
  .$call(shapeOfPerson({ gender: null, count: null }))
  .execute();
// personCountByGender: { gender: 'male' | 'female' | 'other' | null, count: number }[]
```

Any selected field that has the `isAggregate` flag set in it's resolver will trigger a `GROUP BY` expression containing all the selected fields that _don't_ have the `isAggregate` flag set.
