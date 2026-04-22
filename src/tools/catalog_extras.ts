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
const DeptGroupDataShape = {
    title: z.string().optional().describe('Department group display name'),
    position: z.union([z.number(), z.string()]).optional().describe('Display order on keyboard'),
    accountingChapter: z.string().optional().describe('Accounting chapter code'),
    accountingChapterComplement: z.string().optional().describe('Additional accounting chapter reference'),
} satisfies Record<string, ZodTypeAny>;

const AddDeptGroupShape = DeptGroupDataShape satisfies Record<string, ZodTypeAny>;
const EditDeptGroupShape = { id: z.union([z.number().int(), z.string()]).describe('ID of the department group to modify'), ...DeptGroupDataShape } satisfies Record<string, ZodTypeAny>;
const DelDeptGroupShape = { id: z.union([z.number().int(), z.string()]).describe('ID of the department group to delete') } satisfies Record<string, ZodTypeAny>;

const AddVariationShape = { title: z.string().describe("Name of the variation type (e.g. 'Size', 'Color')") } satisfies Record<string, ZodTypeAny>;
const EditVariationShape = { id: z.union([z.number().int(), z.string()]).describe('ID of the variation type to modify'), title: z.string().optional().describe('New name for the variation type') } satisfies Record<string, ZodTypeAny>;
const DelVariationShape = { id: z.union([z.number().int(), z.string()]).describe('ID of the variation type to delete') } satisfies Record<string, ZodTypeAny>;

const VariationChoiceDataShape = {
    idVariation: z.union([z.number(), z.string()]).optional().describe('ID of the parent variation type'),
    title: z.string().optional().describe("Choice label (e.g. 'Large', 'Red')"),
    position: z.union([z.number(), z.string()]).optional().describe('Display order within the variation'),
    deltaPrice: z.union([z.number(), z.string()]).optional().describe('Price adjustment applied when this choice is selected'),
    description: z.string().optional().describe('Additional description for this choice'),
    ending: z.union([z.number(), z.string()]).optional().describe('1 if selecting this choice ends the variation selection flow'),
    unavailable: z.union([z.number(), z.string()]).optional().describe('1 to mark this choice as temporarily unavailable'),
} satisfies Record<string, ZodTypeAny>;

const AddVariationChoiceShape = VariationChoiceDataShape satisfies Record<string, ZodTypeAny>;

const EditVariationChoiceShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the variation choice to modify'),
    ...VariationChoiceDataShape,
} satisfies Record<string, ZodTypeAny>;

const DelVariationChoiceShape = {
    id: z.union([z.number().int(), z.string()]).describe('ID of the variation choice to delete'),
} satisfies Record<string, ZodTypeAny>;


type AddDeptGroupArgs = InferFromShape<typeof AddDeptGroupShape>;
type EditDeptGroupArgs = InferFromShape<typeof EditDeptGroupShape>;
type DelDeptGroupArgs = InferFromShape<typeof DelDeptGroupShape>;

type AddVariationArgs = InferFromShape<typeof AddVariationShape>;
type EditVariationArgs = InferFromShape<typeof EditVariationShape>;
type DelVariationArgs = InferFromShape<typeof DelVariationShape>;

type AddVariationChoiceArgs = InferFromShape<typeof AddVariationChoiceShape>;
type EditVariationChoiceArgs = InferFromShape<typeof EditVariationChoiceShape>;
type DelVariationChoiceArgs = InferFromShape<typeof DelVariationChoiceShape>;

// ============================================================
// REGISTER
// ============================================================

export function registerCatalogExtrasTools(server: McpServer | any) {

    // ---- DEPARTMENT GROUPS ----

    server.registerTool('dept_group.add', {
        title: t('tools.dept_group.add.title'),
        description: t('tools.dept_group.add.description'),
        inputSchema: AddDeptGroupShape,
        annotations: { destructiveHint: false, idempotentHint: false },
    }, async (input: AddDeptGroupArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const { title, ...rest } = input;
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, 'data[title]': title };
        appendData(body, rest);
        const data = await postForm('/workers/addGrpDept.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('dept_group.edit', {
        title: t('tools.dept_group.edit.title'),
        description: t('tools.dept_group.edit.description'),
        inputSchema: EditDeptGroupShape,
        annotations: { destructiveHint: false, idempotentHint: true },
    }, async (input: EditDeptGroupArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const { id, ...rest } = input;
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id };
        appendData(body, rest);
        const data = await postForm('/workers/editGrpDept.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('dept_group.delete', {
        title: t('tools.dept_group.delete.title'),
        description: t('tools.dept_group.delete.description'),
        inputSchema: DelDeptGroupShape,
        annotations: { destructiveHint: true, idempotentHint: true },
    }, async (input: DelDeptGroupArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const data = await postForm('/workers/delGrpDept.php', { shopID: shopId, key: apiKey, id: input.id });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    // ---- VARIATIONS ----

    server.registerTool('variation.add', {
        title: t('tools.variation.add.title'),
        description: t('tools.variation.add.description'),
        inputSchema: AddVariationShape,
        annotations: { destructiveHint: false, idempotentHint: false },
    }, async (input: AddVariationArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const data = await postForm('/workers/addVariation.php', { shopID: shopId, key: apiKey, 'data[title]': input.title });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('variation.edit', {
        title: t('tools.variation.edit.title'),
        description: t('tools.variation.edit.description'),
        inputSchema: EditVariationShape,
        annotations: { destructiveHint: false, idempotentHint: true },
    }, async (input: EditVariationArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id: input.id };
        if (input.title !== undefined) body['data[title]'] = input.title;
        const data = await postForm('/workers/editVariation.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('variation.delete', {
        title: t('tools.variation.delete.title'),
        description: t('tools.variation.delete.description'),
        inputSchema: DelVariationShape,
        annotations: { destructiveHint: true, idempotentHint: true },
    }, async (input: DelVariationArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const data = await postForm('/workers/delVariation.php', { shopID: shopId, key: apiKey, id: input.id });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    // ---- VARIATION CHOICES ----

    server.registerTool('variation_choice.add', {
        title: t('tools.variation_choice.add.title'),
        description: t('tools.variation_choice.add.description'),
        inputSchema: AddVariationChoiceShape,
        annotations: { destructiveHint: false, idempotentHint: false },
    }, async (input: AddVariationChoiceArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const { title, ...rest } = input;
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, 'data[title]': title };
        appendData(body, rest);
        const data = await postForm('/workers/addVariationItem.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('variation_choice.edit', {
        title: t('tools.variation_choice.edit.title'),
        description: t('tools.variation_choice.edit.description'),
        inputSchema: EditVariationChoiceShape,
        annotations: { destructiveHint: false, idempotentHint: true },
    }, async (input: EditVariationChoiceArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const { id, ...rest } = input;
        const body: Record<string, unknown> = { shopID: shopId, key: apiKey, id };
        appendData(body, rest);
        const data = await postForm('/workers/editVariationItem.php', body);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });

    server.registerTool('variation_choice.delete', {
        title: t('tools.variation_choice.delete.title'),
        description: t('tools.variation_choice.delete.description'),
        inputSchema: DelVariationChoiceShape,
        annotations: { destructiveHint: true, idempotentHint: true },
    }, async (input: DelVariationChoiceArgs, ctx: Ctx) => {
        const { shopId, apiKey } = resolveAuth(undefined, ctx);
        const data = await postForm('/workers/delVariationItem.php', { shopID: shopId, key: apiKey, id: input.id });
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }], structuredContent: data };
    });
}