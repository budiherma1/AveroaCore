import { Model } from '@averoa/utilities';

class Category extends Model {
  static tableName = 'categories';

  static column = {
    id: { migration: (m) => m.table.increments(m.column).primary(), flag: { required: false } },
    name: { migration: (m) => m.table.string(m.column, 30).notNullable() },
  };
}

class Item extends Model {
  static tableName = 'items';

  static hidden = ['secret'];

  static column = {
    id: { migration: (m) => m.table.increments(m.column).primary(), flag: { required: false } },
    name: {
      migration: (m) => m.table.string(m.column, 50).notNullable(),
      validation: [{ run: (v) => v.validator.isLength(v.value, { min: 1, max: 50 }), msg: 'must be 1-50 characters' }],
      flag: { unique: true },
    },
    price: { migration: (m) => m.table.decimal(m.column, 10, 2).nullable(), flag: { required: false } },
    stock: { migration: (m) => m.table.integer(m.column).nullable(), flag: { required: false } },
    active: { migration: (m) => m.table.boolean(m.column).defaultTo(true), flag: { required: false } },
    kind: { migration: (m) => m.table.enu(m.column, ['a', 'b']).nullable(), flag: { required: false } },
    tags: { migration: (m) => m.table.json(m.column).nullable(), flag: { required: false, json: true } },
    photo: { migration: (m) => m.table.string(m.column, 200).nullable(), flag: { upload: true } },
    released: { migration: (m) => m.table.date(m.column).nullable(), flag: { required: false } },
    secret: { migration: (m) => m.table.string(m.column, 20).nullable(), flag: { required: false } },
    note: { flag: { required: false }, openapi: { description: 'Free text' } },
  };

  static relationMappings = () => ({
    category: {
      relation: Model.BelongsToOneRelation,
      modelClass: Category,
      join: { from: 'items.id', to: 'categories.id' },
    },
  });
}

export { Category };
export default Item;
