// Schéma vide par défaut (utile si tu veux temporairement neutraliser un tool)
export const EmptyObjectSchema = {
    type: 'object',
    properties: {},
    additionalProperties: false
};
// ---- AUTH
export const AuthInputSchema = {
    type: 'object',
    required: ['login', 'password'],
    properties: {
        login: { type: 'string' },
        password: { type: 'string' }
    },
    additionalProperties: false
};
// ---- DATA (commun)
export const CommonListSchema = {
    type: 'object',
    required: ['shopId', 'apiKey'],
    properties: {
        shopId: { type: 'string' },
        apiKey: { type: 'string' },
        format: { type: 'string', enum: ['json', 'csv', 'html'], default: 'json' }
    },
    additionalProperties: false
};
// ---- SALES export
export const SalesExportSchema = {
    type: 'object',
    required: ['shopId', 'apiKey', 'formatExport'],
    properties: {
        shopId: { type: 'string' },
        apiKey: { type: 'string' },
        d: { type: 'integer' },
        m: { type: 'integer' },
        y: { type: 'integer' },
        formatExport: { type: 'string', enum: ['Std', 'PDF', 'XLS', 'CSV', 'frafec', 'saft'] }
    },
    additionalProperties: false
};
// ---- SALES create (JSON v2 + fallback legacy)
export const SalesCreateSchema = {
    type: 'object',
    required: ['shopId', 'apiKey', 'payment', 'deliveryMethod', 'items'],
    properties: {
        shopId: { type: 'string' },
        apiKey: { type: 'string' },
        idUser: { type: 'integer' },
        payment: { type: 'integer' },
        deliveryMethod: {
            oneOf: [
                { type: 'integer', minimum: 0, maximum: 6 },
                { type: 'string', enum: ['0', '1', '2', '3', '4', '5', '6'] }
            ]
        },
        idClient: { type: 'integer' },
        client: {
            type: 'object',
            additionalProperties: false,
            properties: {
                nom: { type: 'string' },
                prenom: { type: 'string' },
                email: { type: 'string' },
                telephone: { type: 'string' },
                adresseligne1: { type: 'string' },
                adresseligne2: { type: 'string' },
                commentaireadresse: { type: 'string' },
                codepostal: { type: 'string' },
                ville: { type: 'string' },
                pays: { type: 'string' },
                numtva: { type: 'string' },
                rcs: { type: 'string' },
                codeBarre: { type: 'string' },
                telephone2: { type: 'string' },
                lat: { type: 'string' },
                lng: { type: 'string' }
            }
        },
        items: {
            type: 'array',
            minItems: 1,
            items: {
                oneOf: [
                    {
                        type: 'object',
                        required: ['type', 'productId'],
                        additionalProperties: false,
                        properties: {
                            type: { const: 'catalog' },
                            productId: { type: 'integer', minimum: 1 },
                            quantity: { type: 'number', minimum: 0.0001, default: 1 },
                            titleOverride: { type: 'string' },
                            priceOverride: { type: 'number', minimum: 0 },
                            declinaisons: { type: 'array', items: { type: 'integer' }, maxItems: 5 },
                            taxRateId: { type: ['integer', 'null'] },
                            discounts: {
                                type: 'array',
                                items: {
                                    type: 'object',
                                    required: ['mode', 'value'],
                                    additionalProperties: false,
                                    properties: {
                                        mode: { enum: ['amount', 'percent'] },
                                        value: { type: 'number', minimum: 0 }
                                    }
                                }
                            },
                            note: { type: 'string' }
                        }
                    },
                    {
                        type: 'object',
                        required: ['type', 'departmentId', 'title', 'price'],
                        additionalProperties: false,
                        properties: {
                            type: { const: 'free' },
                            departmentId: { type: 'integer', minimum: 1 },
                            title: { type: 'string' },
                            price: { type: 'number', minimum: 0 },
                            quantity: { type: 'number', minimum: 0.0001, default: 1 }
                        }
                    }
                ]
            }
        },
        orderDiscounts: {
            type: 'array',
            items: {
                type: 'object',
                required: ['mode', 'value'],
                additionalProperties: false,
                properties: {
                    mode: { enum: ['amount', 'percent'] },
                    value: { type: 'number', minimum: 0 }
                }
            }
        },
        metadata: { type: 'object', additionalProperties: true },
        idempotencyKey: { type: 'string' }
    },
    additionalProperties: false
};
