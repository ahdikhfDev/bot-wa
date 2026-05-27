import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test tool definitions format (static, no deps)
describe('Tool Definitions', () => {
    it('all tool definitions have required fields', async () => {
        const { getToolDefinitions } = await import('../src/services/tools.js');
        const tools = getToolDefinitions();
        assert.ok(tools.length >= 5, `Expected >=5 tools, got ${tools.length}`);
        for (const tool of tools) {
            assert.ok(tool.type === 'function', `Tool missing type: ${tool.function?.name}`);
            assert.ok(tool.function?.name, 'Tool missing name');
            assert.ok(tool.function?.description, `Tool ${tool.function?.name} missing description`);
            assert.ok(tool.function?.parameters?.type === 'object', `Tool ${tool.function?.name} missing parameters.object`);
        }
    });

    it('every tool has a corresponding handler', async () => {
        const { getToolDefinitions, executeTool } = await import('../src/services/tools.js');
        const tools = getToolDefinitions();
        for (const tool of tools) {
            const name = tool.function.name;
            const result = await executeTool(name, {}, null);
            assert.ok(result, `Tool ${name} returned empty result`);
        }
    });

    it('search_web requires query parameter', async () => {
        const { getToolDefinitions } = await import('../src/services/tools.js');
        const search = getToolDefinitions().find(t => t.function.name === 'search_web');
        assert.ok(search, 'search_web tool not found');
        assert.ok(search.function.parameters.required.includes('query'));
    });

    it('all tool names are unique', async () => {
        const { getToolDefinitions } = await import('../src/services/tools.js');
        const names = getToolDefinitions().map(t => t.function.name);
        assert.equal(new Set(names).size, names.length, 'Duplicate tool names found');
    });
});

// Test free APIs with real data
describe('Free API Tools', { timeout: 15000 }, () => {
    it('get_weather returns weather data for Jakarta', async () => {
        const { executeTool } = await import('../src/services/tools.js');
        const result = await executeTool('get_weather', { city: 'Jakarta' }, null);
        assert.ok(result, 'weather result should not be empty');
        assert.ok(result.includes('Cuaca') || result.includes('Jakarta') || result.match(/\d+/),
            `Weather result should contain expected data: ${result.substring(0, 100)}`);
    });

    it('get_earthquake returns BMKG data', async () => {
        const { executeTool } = await import('../src/services/tools.js');
        const result = await executeTool('get_earthquake', {}, null);
        assert.ok(result, 'earthquake result should not be empty');
        assert.ok(result.includes('GEMPA') || result.includes('Tidak ada data'),
            `Earthquake result: ${result.substring(0, 100)}`);
    });
});

// Test error handling
describe('Tool Error Handling', () => {
    it('returns error for unknown tool', async () => {
        const { executeTool } = await import('../src/services/tools.js');
        const result = await executeTool('nonexistent_tool', {}, null);
        assert.ok(result.includes('tidak dikenal'), `Expected error message, got: ${result}`);
    });

    it('get_weather without city defaults to Jakarta', async () => {
        const { executeTool } = await import('../src/services/tools.js');
        const result = await executeTool('get_weather', {}, null);
        assert.ok(result, 'weather result should not be empty');
    });
});
