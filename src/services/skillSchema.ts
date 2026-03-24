import type { SchemaObject } from 'ajv';

export const skillSchema: SchemaObject = {
  type: 'object',
  required: ['name', 'displayName', 'version', 'description', 'installedAt', 'installedFrom', 'lastUpdated'],
  properties: {
    name: {
      type: 'string',
      pattern: '^[a-z0-9-]+$',
      minLength: 1,
      maxLength: 50,
    },
    displayName: {
      type: 'string',
      minLength: 1,
      maxLength: 100,
    },
    version: {
      type: 'string',
      pattern: '^\\d+\\.\\d+\\.\\d+(-[a-zA-Z0-9.]+)?$',
    },
    description: {
      type: 'string',
      minLength: 1,
      maxLength: 500,
    },
    agent: { type: 'string' },
    model: { type: 'string' },
    template: { type: 'string' },
    subtask: { type: 'boolean' },
    author: { type: 'string' },
    homepage: { type: 'string', format: 'uri' },
    repository: { type: 'string', format: 'uri' },
    license: { type: 'string' },
    installedAt: { type: 'string', format: 'date-time' },
    installedFrom: { type: 'string' },
    lastUpdated: { type: 'string', format: 'date-time' },
    dependencies: {
      type: 'object',
      properties: {
        skills: { type: 'array', items: { type: 'string' } },
        minVersion: { type: 'string' },
      },
    },
    $schema: { type: 'string' },
  },
  additionalProperties: false,
};
