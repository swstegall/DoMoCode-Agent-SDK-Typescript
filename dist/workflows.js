import { encodePathSegment } from "./transport.js";
import { isRecord, requiredArray, requiredBoolean, requiredNumber, requiredString } from "./types/common.js";
/** REST client for the server-owned durable workflow state machine. */
export class WorkflowClient {
    transport;
    constructor(transport) {
        this.transport = transport;
    }
    async definitions(options = {}) {
        return requiredArray(await this.transport.json("/workflows", { ...signalOptions(options.signal) }), "workflows").map(decodeWorkflowDefinition);
    }
    async list(options = {}) {
        return this.definitions(options);
    }
    async runs(workflowId, options = {}) {
        const path = workflowPath(workflowId, "/runs");
        return requiredArray(await this.transport.json(path, { ...signalOptions(options.signal) }), "workflow runs").map(decodeWorkflowRunRecord);
    }
    async records(workflowId, options = {}) {
        return this.runs(workflowId, options);
    }
    async get(workflowId, runId, options = {}) {
        const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}`);
        return decodeWorkflowRunRecord(await this.transport.json(path, { ...signalOptions(options.signal) }));
    }
    async run(workflowId, sessionIdOrOptions, input = null, runId, options = {}) {
        const request = typeof sessionIdOrOptions === "string"
            ? { sessionId: sessionIdOrOptions, input, ...(runId === undefined ? {} : { runId }), ...options }
            : sessionIdOrOptions;
        const body = { sessionID: request.sessionId, input: request.input ?? null };
        if (request.runId !== undefined)
            body.runID = request.runId;
        const path = workflowPath(workflowId, "/run");
        return decodeWorkflowRunRecord(await this.transport.json(path, {
            method: "POST",
            body,
            expectedStatus: 202,
            ...signalOptions(request.signal)
        }));
    }
    async resume(workflowId, runId, sessionId, options = {}) {
        const body = sessionId === undefined ? {} : { sessionID: sessionId };
        const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/resume`);
        return decodeWorkflowRunRecord(await this.transport.json(path, {
            method: "POST",
            body,
            expectedStatus: 202,
            ...signalOptions(options.signal)
        }));
    }
    async cancel(workflowId, runId, options = {}) {
        return this.transition(workflowId, runId, "cancel", options);
    }
    async pause(workflowId, runId, options = {}) {
        return this.transition(workflowId, runId, "pause", options);
    }
    async approvals(workflowId, runId, options = {}) {
        const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/approvals`);
        return requiredArray(await this.transport.json(path, { ...signalOptions(options.signal) }), "workflow approvals").map(decodeWorkflowApprovalRequest);
    }
    async decide(workflowId, runId, stageId, decision, reason, options = {}) {
        if (stageId.trim().length === 0)
            throw new TypeError("Workflow approval stageId must not be empty");
        const body = { stageID: stageId, decision, ...(reason === undefined ? {} : { reason }) };
        const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/approval`);
        await this.transport.json(path, {
            method: "POST",
            body,
            expectedStatus: 200,
            ...signalOptions(options.signal)
        });
    }
    async export(workflowId, runId, options = {}) {
        const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/export`);
        return requiredArray(await this.transport.json(path, { ...signalOptions(options.signal) }), "workflow export").map(decodeWorkflowStoreRecord);
    }
    async exportRun(workflowId, runId, options = {}) {
        return this.export(workflowId, runId, options);
    }
    async transition(workflowId, runId, action, options) {
        const path = workflowPath(workflowId, `/run/${encodePathSegment(runId)}/${action}`);
        return decodeWorkflowRunRecord(await this.transport.json(path, {
            method: "POST",
            expectedStatus: 200,
            ...signalOptions(options.signal)
        }));
    }
}
export function workflowPath(workflowId, suffix = "") {
    return `/workflow/${encodePathSegment(workflowId)}${suffix}`;
}
export function decodeWorkflowDefinition(value) {
    const record = object(value, "workflow definition");
    return {
        ...record,
        id: requiredString(record.id, "workflow.id"),
        displayName: requiredString(record.displayName, "workflow.displayName"),
        version: requiredNumber(record.version, "workflow.version"),
        executionMode: requiredString(record.executionMode, "workflow.executionMode"),
        stages: requiredArray(record.stages, "workflow.stages").map(decodeWorkflowStageDefinition),
        metadata: metadata(record.metadata, "workflow.metadata")
    };
}
export function decodeWorkflowStageDefinition(value) {
    const record = object(value, "workflow stage");
    const model = optionalString(record.model, "workflow stage.model");
    const profile = optionalString(record.profile, "workflow stage.profile");
    const outputArtifact = optionalString(record.outputArtifact, "workflow stage.outputArtifact");
    const timeoutSeconds = optionalNumber(record.timeoutSeconds, "workflow stage.timeoutSeconds");
    return {
        ...record,
        id: requiredString(record.id, "workflow stage.id"),
        displayName: requiredString(record.displayName, "workflow stage.displayName"),
        kind: requiredString(record.kind, "workflow stage.kind"),
        dependencies: strings(record.dependencies, "workflow stage.dependencies"),
        toolPolicy: decodeWorkflowToolPolicy(record.toolPolicy),
        ...(model === undefined ? {} : { model }),
        ...(profile === undefined ? {} : { profile }),
        contextInputs: strings(record.contextInputs, "workflow stage.contextInputs"),
        ...(outputArtifact === undefined ? {} : { outputArtifact }),
        budget: decodeWorkflowBudget(record.budget),
        ...(timeoutSeconds === undefined ? {} : { timeoutSeconds }),
        cancellationPolicy: requiredString(record.cancellationPolicy, "workflow stage.cancellationPolicy"),
        approvalBoundary: requiredString(record.approvalBoundary, "workflow stage.approvalBoundary"),
        metadata: metadata(record.metadata, "workflow stage.metadata")
    };
}
export function decodeWorkflowRunRecord(value) {
    const record = object(value, "workflow run");
    const error = optionalString(record.error, "workflow run.error");
    return {
        ...record,
        id: requiredString(record.id, "workflow run.id"),
        workflowId: requiredAlias(record, "workflow run.workflowId", "workflowID", "workflowId"),
        status: requiredString(record.status ?? record.state, "workflow run.status"),
        createdAt: requiredString(record.createdAt, "workflow run.createdAt"),
        updatedAt: requiredString(record.updatedAt, "workflow run.updatedAt"),
        input: (record.input ?? null),
        stages: record.stages === undefined || record.stages === null ? [] : requiredArray(record.stages, "workflow run.stages").map(decodeWorkflowStageRunRecord),
        output: (record.output ?? null),
        ...(error === undefined ? {} : { error }),
        cancellationRequested: record.cancellationRequested === undefined ? false : requiredBoolean(record.cancellationRequested, "workflow run.cancellationRequested"),
        metadata: metadata(record.metadata, "workflow run.metadata")
    };
}
export function decodeWorkflowStageRunRecord(value) {
    const record = object(value, "workflow stage run");
    const startedAt = optionalString(record.startedAt, "workflow stage run.startedAt");
    const finishedAt = optionalString(record.finishedAt, "workflow stage run.finishedAt");
    const error = optionalString(record.error, "workflow stage run.error");
    return {
        ...record,
        stageId: requiredAlias(record, "workflow stage run.stageId", "stageID", "stageId"),
        status: requiredString(record.status, "workflow stage run.status"),
        ...(startedAt === undefined ? {} : { startedAt }),
        ...(finishedAt === undefined ? {} : { finishedAt }),
        output: (record.output ?? null),
        ...(error === undefined ? {} : { error }),
        agentIds: stringsFromAliases(record, "workflow stage run.agentIds", "agentIDs", "agentIds"),
        evidence: record.evidence === undefined || record.evidence === null ? [] : requiredArray(record.evidence, "workflow stage run.evidence").map(decodeWorkflowEvidence),
        metadata: metadata(record.metadata, "workflow stage run.metadata")
    };
}
export function decodeWorkflowEvidence(value) {
    const record = object(value, "workflow evidence");
    const sessionId = optionalString(record.sessionID ?? record.sessionId, "workflow evidence.sessionId");
    const locator = optionalString(record.locator, "workflow evidence.locator");
    return {
        ...record,
        id: requiredString(record.id, "workflow evidence.id"),
        stageId: requiredAlias(record, "workflow evidence.stageId", "stageID", "stageId"),
        source: requiredString(record.source, "workflow evidence.source"),
        ...(sessionId === undefined ? {} : { sessionId }),
        kind: requiredString(record.kind, "workflow evidence.kind"),
        untrustedData: requiredBoolean(record.untrustedData, "workflow evidence.untrustedData"),
        summary: requiredString(record.summary, "workflow evidence.summary"),
        ...(locator === undefined ? {} : { locator }),
        metadata: metadata(record.metadata, "workflow evidence.metadata")
    };
}
export function decodeWorkflowApprovalRequest(value) {
    const record = object(value, "workflow approval");
    const stage = record.stage ?? (record.stageId === undefined ? undefined : { id: record.stageId, displayName: record.stageId, kind: "execute", dependencies: [], toolPolicy: { mode: "readOnly", allowedTools: [] }, contextInputs: [], budget: {}, cancellationPolicy: "stopDependents", approvalBoundary: "none", metadata: {} });
    return {
        ...record,
        workflowId: requiredAlias(record, "workflow approval.workflowId", "workflowID", "workflowId"),
        runId: requiredAlias(record, "workflow approval.runId", "runID", "runId"),
        stage: decodeWorkflowStageDefinition(stage)
    };
}
export function decodeWorkflowStoreRecord(value) {
    const record = object(value, "workflow store record");
    return {
        ...record,
        kind: requiredString(record.kind, "workflow store record.kind"),
        id: requiredString(record.id, "workflow store record.id"),
        timestamp: requiredString(record.timestamp, "workflow store record.timestamp"),
        ...(record.definition === undefined || record.definition === null ? {} : { definition: decodeWorkflowDefinition(record.definition) }),
        ...(record.run === undefined || record.run === null ? {} : { run: decodeWorkflowRunRecord(record.run) })
    };
}
function decodeWorkflowToolPolicy(value) {
    if (value === undefined || value === null)
        return { mode: "readOnly", allowedTools: [] };
    const record = object(value, "workflow tool policy");
    return {
        mode: requiredString(record.mode, "workflow tool policy.mode"),
        allowedTools: record.allowedTools === undefined || record.allowedTools === null ? [] : strings(record.allowedTools, "workflow tool policy.allowedTools")
    };
}
function decodeWorkflowBudget(value) {
    if (value === undefined || value === null)
        return {};
    const record = object(value, "workflow budget");
    const maxTokens = optionalNumber(record.maxTokens, "workflow budget.maxTokens");
    const maxCostUSD = optionalNumber(record.maxCostUSD, "workflow budget.maxCostUSD");
    const wallClockSeconds = optionalNumber(record.wallClockSeconds, "workflow budget.wallClockSeconds");
    return {
        ...(maxTokens === undefined ? {} : { maxTokens }),
        ...(maxCostUSD === undefined ? {} : { maxCostUSD }),
        ...(wallClockSeconds === undefined ? {} : { wallClockSeconds })
    };
}
function object(value, field) {
    if (!isRecord(value))
        throw new TypeError(`${field} must be an object`);
    return value;
}
function metadata(value, field) {
    if (value === undefined || value === null)
        return {};
    if (!isRecord(value))
        throw new TypeError(`${field} must be an object`);
    return value;
}
function strings(value, field) {
    return requiredArray(value, field).map((item) => requiredString(item, field));
}
function stringsFromAliases(record, field, ...keys) {
    const value = first(record, keys);
    return value === undefined || value === null ? [] : strings(value, field);
}
function requiredAlias(record, field, ...keys) {
    const value = first(record, keys);
    return requiredString(value, field);
}
function optionalString(value, field) {
    return value === undefined || value === null ? undefined : requiredString(value, field);
}
function optionalNumber(value, field) {
    return value === undefined || value === null ? undefined : requiredNumber(value, field);
}
function first(record, keys) {
    for (const key of keys)
        if (record[key] !== undefined && record[key] !== null)
            return record[key];
    return undefined;
}
function signalOptions(signal) {
    return signal === undefined ? {} : { signal };
}
//# sourceMappingURL=workflows.js.map