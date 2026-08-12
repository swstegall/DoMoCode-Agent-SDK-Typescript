export function validateClientToolDefinitions(definitions) {
    const names = new Set();
    return definitions.map((definition) => {
        if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(definition.name))
            throw new TypeError(`Invalid client tool name: ${definition.name}`);
        if (definition.description.trim().length === 0)
            throw new TypeError(`Client tool ${definition.name} requires a description`);
        if (!definition.inputSchema || typeof definition.inputSchema !== "object" || Array.isArray(definition.inputSchema))
            throw new TypeError(`Client tool ${definition.name} requires an object inputSchema`);
        if (names.has(definition.name))
            throw new TypeError(`Client tool ${definition.name} is registered more than once`);
        names.add(definition.name);
        return { name: definition.name, description: definition.description, inputSchema: definition.inputSchema };
    });
}
//# sourceMappingURL=tools.js.map