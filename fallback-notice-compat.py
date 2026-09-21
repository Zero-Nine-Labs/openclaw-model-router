#!/usr/bin/env python3
"""Pinned fallback-notice repair for OpenClaw 2026.9.3."""

import compat

# Pinned SHA256 hashes of agent-runner.runtime-ChH8PGBC.mjs
ORIGINAL_HASHES = {
    "agent-runner.runtime-ChH8PGBC.mjs": "611f4dea79b1a3908a30de2ae155072e302f995259d13b578752b1b2fab309be",
}

PATCHED_HASHES = {
    "agent-runner.runtime-ChH8PGBC.mjs": "5baeeffddbdb8c8d5d0c1f3cab190e98da2e4dcbe7d69865029345242aad5762",
}

BACKUP_DIRNAME = ".openclaw-fallback-notice-backup"

# Exact search and replacement transformations
PATCH_TRANSFORMS = {
    "agent-runner.runtime-ChH8PGBC.mjs": [
        (
            (
                "function resolveFallbackOriginModel(params) {\n"
                "\tif (params.runtimeModelSelection) return {\n"
                "\t\t...params.runtimeModelSelection,\n"
                "\t\tpersistedAutoFallback: false\n"
                "\t};\n"
                "\tconst entry = params.fallbackStateEntry;\n"
                "\tif ((entry?.modelOverrideSource === \"auto\" || entry !== void 0 && entry.modelOverrideSource === void 0 && hasSessionAutoModelFallbackProvenance(entry)) && entry !== void 0) {\n"
                "\t\tconst originProvider = normalizeOptionalString(entry.modelOverrideFallbackOriginProvider);\n"
                "\t\tconst originModel = normalizeOptionalString(entry.modelOverrideFallbackOriginModel);\n"
                "\t\tif (originProvider && originModel) return {\n"
                "\t\t\tprovider: originProvider,\n"
                "\t\t\tmodel: originModel,\n"
                "\t\t\tpersistedAutoFallback: true\n"
                "\t\t};\n"
                "\t}\n"
                "\treturn {\n"
                "\t\tprovider: params.run.provider,\n"
                "\t\tmodel: params.run.model,\n"
                "\t\tpersistedAutoFallback: false\n"
                "\t};\n"
                "}"
            ),
            (
                "function resolveFallbackOriginModel(params) {\n"
                "\tif (params.runtimeModelSelection) return {\n"
                "\t\t...params.runtimeModelSelection,\n"
                "\t\tpersistedAutoFallback: false\n"
                "\t};\n"
                "\tconst entry = params.fallbackStateEntry;\n"
                "\tif ((entry?.modelOverrideSource === \"auto\" || entry !== void 0 && entry.modelOverrideSource === void 0 && hasSessionAutoModelFallbackProvenance(entry)) && entry !== void 0) {\n"
                "\t\tconst originProvider = normalizeOptionalString(entry.modelOverrideFallbackOriginProvider);\n"
                "\t\tconst originModel = normalizeOptionalString(entry.modelOverrideFallbackOriginModel);\n"
                "\t\tif (originProvider && originModel) return {\n"
                "\t\t\tprovider: originProvider,\n"
                "\t\t\tmodel: originModel,\n"
                "\t\t\tpersistedAutoFallback: true\n"
                "\t\t};\n"
                "\t}\n"
                "\tif (params.executionTrace?.fallbackUsed === false && (params.fallbackAttempts?.length ?? 0) === 0) {\n"
                "\t\tconst activeProvider = normalizeOptionalString(params.activeModel?.provider);\n"
                "\t\tconst activeModelId = normalizeOptionalString(params.activeModel?.model);\n"
                "\t\tif (activeProvider && activeModelId) return {\n"
                "\t\t\t...params.activeModel,\n"
                "\t\t\tprovider: activeProvider,\n"
                "\t\t\tmodel: activeModelId,\n"
                "\t\t\tpersistedAutoFallback: false\n"
                "\t\t};\n"
                "\t}\n"
                "\treturn {\n"
                "\t\tprovider: params.run.provider,\n"
                "\t\tmodel: params.run.model,\n"
                "\t\tpersistedAutoFallback: false\n"
                "\t};\n"
                "}"
            ),
        ),
        (
            (
                "\tconst configuredFallbackModel = resolveFallbackOriginModel({\n"
                "\t\trun: followupRun.run,\n"
                "\t\tfallbackStateEntry,\n"
                "\t\truntimeModelSelection\n"
                "\t});"
            ),
            (
                "\tconst configuredFallbackModel = resolveFallbackOriginModel({\n"
                "\t\trun: followupRun.run,\n"
                "\t\tfallbackStateEntry,\n"
                "\t\truntimeModelSelection,\n"
                "\t\texecutionTrace: runResult.meta?.executionTrace,\n"
                "\t\tfallbackAttempts,\n"
                "\t\tactiveModel: sessionModel\n"
                "\t});"
            ),
        ),
    ],
}


if __name__ == "__main__":
    compat.PROFILES = {"2026.9.3-fallback-notice": {
        "original_hashes": ORIGINAL_HASHES,
        "patched_hashes": PATCHED_HASHES,
        "transforms": PATCH_TRANSFORMS,
    }}
    compat.BACKUP_DIRNAME = BACKUP_DIRNAME
    compat.main()
