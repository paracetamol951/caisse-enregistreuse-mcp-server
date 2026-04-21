import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z, ZodTypeAny } from 'zod';
import { postForm } from '../support/http.js';
import { t } from '../i18n/index.js';
import { resolveAuth, type Ctx } from '../context.js';

type InferFromShape<S extends Record<string, ZodTypeAny>> = z.infer<z.ZodObject<S>>;

function appendData(body: Record<string, unknown>, fields: Record<string, unknown>) {
    for (const [k, v] of Object.entries(fields)) {
        if (v !== undefined && v !== null) body[`data[${k}]`] = v;
    }
}

// ============================================================
// DEPARTMENT GROUPS
// ============================================================

const DeptGroupDataShape = {
    title: z.string().optional(),
    position: z.union([z.number(), z.string()]).optional(),
    accountingChapter: z.string().optional(),
    accountingChapterComplement: z.string().optional(),
} satisfies Record<string, ZodTypeAny>;

const AddDeptGroupShape = DeptGroupDataShape satisfies Record<string, ZodTypeAny>;
const EditDeptGroupShape = { id: z.union([z.number().int(), z.string()]), ...DeptGroupDataShape } satisfies Record<string, ZodTypeAny>;
const DelDeptGroupShape = { id: z.union([z.number().int(), z.string()]) } satisfies Record<string, ZodTypeAny>;

type AddDeptGroupArgs = InferFromShape<typeof AddDeptGroupShape>;
type EditDeptGroupArgs = InferFromShape<typeof EditDeptGroupShape>;
type DelDeptGroupArgs = InferFromShape<typeof DelDeptGroupShape>;

// ============================================================
// VARIATIONS
// ============================================================

const AddVariationShape = { title: z.string() } satisfies Record<string, ZodTypeAny>;
const EditVariationShape = { id: z.union([z.number().int(), z.string()]), title: z.string().optional() } satisfies Record<string, ZodTypeAny>;
const DelVariationShape = { id: z.union([z.number().int(), z.string()]) } satisfies Record<string, ZodTypeAny>;

type AddVariationArgs = InferFromShape<typeof AddVariationShape>;
type EditVariationArgs = InferFromShape<typeof EditVariationShape>;
type DelVariationArgs = InferFromShape<typeof DelVariationShape>;

// ============================================================
// VARIATION CHOICES
// ============================================================

const VariationChoiceDataShape = {
    idVariation: z.union([z.number(), z.string()]).optional(),
    title: z.string().optional(),
    position: z.union([z.number(), z.string()]).optional(),
    deltaPrice: z.union([z.number(), z.string()]).optional(),
    description: z.string().optional(),
    ending: z.union([z.number(), z.string()]).optional(),
    unavailable: z.union([z.number(), z.string()]).optional(),
} satisfies Record<string, ZodTypeAny>;

const AddVariationChoiceShape = VariationChoiceDataShape satisfies Record<string, ZodTypeAny>;

const EditVariationChoiceShape = {
    id: z.union([z.number().int(), z.string()]),
    ...VariationChoiceDataShape,
} satisfies Record<string, ZodTypeAny>;

const DelVariationChoiceShape = {
    id: z.union([z.number().int(), z.string()]),
} satisfies Record<string, ZodTypeAny>;

type AddVariationChoiceArgs = InferFromShape<typeof AddVariationChoiceShape>;
type EditVariationChoiceArgs = InferFromShape<typeof EditVariationChoiceShape>;
type DelVariationChoiceArgs = InferFromShape<typeof DelVariationChoiceShape>;

// ============================================================
// REGISTER
// ============================================================

export function registerCatalogExtrasTools(server: McpServer | any) {

    // ---- DEPARTMENT GROUPS ----

    server.registerTool('dept_group_add', {
        title: t('tools.dept_group_add.title'),
        description: t('tools.dept_group_add.description'),
        inputSchema: AddDeptGroupShape,
    }, async (input: AddDeptGroupArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const { title, ...rest } = input;
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, 'data[title]': title };
        appendData(body, rest);
        const data = await postForm('/workers/addGrpDept.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('dept_group_edit', {
        title: t('tools.dept_group_edit.title'),
        description: t('tools.dept_group_edit.description'),
        inputSchema: EditDeptGroupShape,
    }, async (input: EditDeptGroupArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const { id, ...rest } = input;
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id };
        appendData(body, rest);
        const data = await postForm('/workers/editGrpDept.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('dept_group_delete', {
        title: t('tools.dept_group_delete.title'),
        description: t('tools.dept_group_delete.description'),
        inputSchema: DelDeptGroupShape,
    }, async (input: DelDeptGroupArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const data = await postForm('/workers/delGrpDept.php', { shopID: shopId, key: apiKey, id: input.id });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    // ---- VARIATIONS ----

    server.registerTool('variation_add', {
        title: t('tools.variation_add.title'),
        description: t('tools.variation_add.description'),
        inputSchema: AddVariationShape,
    }, async (input: AddVariationArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const data = await postForm('/workers/addVariation.php', { shopID: shopId, key: apiKey, 'data[title]': input.title });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('variation_edit', {
        title: t('tools.variation_edit.title'),
        description: t('tools.variation_edit.description'),
        inputSchema: EditVariationShape,
    }, async (input: EditVariationArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id: input.id };
        if (input.title !== undefined) body['data[title]'] = input.title;
        const data = await postForm('/workers/editVariation.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('variation_delete', {
        title: t('tools.variation_delete.title'),
        description: t('tools.variation_delete.description'),
        inputSchema: DelVariationShape,
    }, async (input: DelVariationArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const data = await postForm('/workers/delVariation.php', { shopID: shopId, key: apiKey, id: input.id });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    // ---- VARIATION CHOICES ----

    server.registerTool('variation_choice_add', {
        title: t('tools.variation_choice_add.title'),
        description: t('tools.variation_choice_add.description'),
        inputSchema: AddVariationChoiceShape,
    }, async (input: AddVariationChoiceArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const { title, ...rest } = input;
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, 'data[title]': title };
        appendData(body, rest);
        const data = await postForm('/workers/addVariationItem.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('variation_choice_edit', {
        title: t('tools.variation_choice_edit.title'),
        description: t('tools.variation_choice_edit.description'),
        inputSchema: EditVariationChoiceShape,
    }, async (input: EditVariationChoiceArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const { id, ...rest } = input;
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id };
        appendData(body, rest);
        const data = await postForm('/workers/editVariationItem.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('variation_choice_delete', {
        title: t('tools.variation_choice_delete.title'),
        description: t('tools.variation_choice_delete.description'),
        inputSchema: DelVariationChoiceShape,
    }, async (input: DelVariationChoiceArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const data = await postForm('/workers/delVariationItem.php', { shopID: shopId, key: apiKey, id: input.id });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });
}