import { z } from 'zod';
import Router from '@averoa/routes';
import { validate } from '@averoa/utilities';

const router = Router();

router.get('/', (req, res) => res.json({ name: 'fixture' }));

router.post('/auth/login', 'AuthController@login', [validate({
  body: {
    email: {
      type: 'string',
      format: 'email',
      description: 'Account email',
      validation: [{ run: (v) => v.validator.isEmail(v.value), msg: 'email format required' }],
    },
    password: { type: 'string' },
  },
  query: z.object({ redirect: z.string().optional() }),
})]).doc({
  summary: 'Log in',
  tags: ['Auth'],
  responses: {
    200: { description: 'Token issued', schema: z.object({ status: z.literal(true), data: z.object({ token: z.string() }) }) },
    401: 'Invalid email or password',
  },
});

router.middleware(['AuthMiddleware'], () => {
  router.get('/auth/me', 'AuthController@me');
  router.get('/internal', 'ItemController@internal').doc({ exclude: true });
  router.get('/public-inside', 'AuthController@me').doc({ security: false });
});

router.get('/files/*path', (req, res) => res.json({}));
router.all('/anything', (req, res) => res.json({}));

router.crud('Item', 'items', () => {
  router.get('/', 'ItemController@findAll');
  router.get('/:id', 'ItemController@findOne');
  router.postForm('/', 'ItemController@create', ['AuthMiddleware']);
  router.put('/:id', 'ItemController@update', ['AuthMiddleware']);
  router.delete('/:id', 'ItemController@delete', ['AuthMiddleware']).doc({ summary: 'Remove an item', deprecated: true });
});

export default router;
