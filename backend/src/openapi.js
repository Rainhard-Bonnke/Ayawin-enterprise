const openapi = {
  openapi: '3.0.3',
  info: {
    title: 'Martin Enterprise ERP API',
    version: '1.0.0',
    description: 'Module 1: Foundation & Auth',
  },
  servers: [{ url: '/api/v1' }],
  components: {
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
  },
  security: [{ bearerAuth: [] }],
  paths: {
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Login with email/password (optional MFA)',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string' },
                  password: { type: 'string' },
                  mfa_token: { type: 'string' },
                  company_code: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { 200: { description: 'Tokens issued' } },
      },
    },
    '/auth/refresh': {
      post: {
        tags: ['Auth'],
        summary: 'Refresh access token',
        security: [],
      },
    },
    '/auth/me': { get: { tags: ['Auth'], summary: 'Current user profile' } },
    '/companies/current': { get: { tags: ['Companies'], summary: 'Current company' } },
    '/companies/branches': { get: { tags: ['Companies'], summary: 'List branches' } },
    '/roles': { get: { tags: ['RBAC'], summary: 'List roles' } },
    '/roles/permissions': { get: { tags: ['RBAC'], summary: 'List permissions' } },
    '/users': { get: { tags: ['Users'], summary: 'List users' } },
    '/settings': { get: { tags: ['Settings'], summary: 'System settings' } },
    '/audit': { get: { tags: ['Audit'], summary: 'Audit trail' } },
    '/currencies': { get: { tags: ['Currencies'], summary: 'Currency master' } },
  },
};

module.exports = openapi;
