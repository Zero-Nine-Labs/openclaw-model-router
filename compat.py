#!/usr/bin/env python3
"""OpenClaw 2026.9.3 Compatibility Patcher for Model Router Plugin.

Provides explicit, safe, and idempotent compatibility patching for OpenClaw host
files to support thinking effort routing via before_model_resolve hooks without
requiring global config or session mutation.

Supported actions:
  --check    Verify current state of host files (patched, unpatched, or mismatch)
  --apply    Preflight, backup originals, and apply compatibility patches
  --restore  Restore exact original host files from backup or verified originals
"""

import argparse
import hashlib
import os
import shutil
import sys
import tempfile
from pathlib import Path

# Pinned SHA256 hashes of the exact original OpenClaw 2026.9.3 host files
ORIGINAL_HASHES = {
    "agent-runner-utils-Bd5FUrZ1.mjs": "a34aa689dbb100a5562dae4872bc4be4be26650017cbe5b19ae0919a80d542bb",
    "attempt-execution-crM9pZWL.mjs": "4e521234c4799e69d6040a8d58ad896568b9279c977d1337b80ba4de2e7a98dd",
    "embedded-agent-DNQn_PMM.mjs": "21a919ebd72def44cdb3a5df6d558da2e0db48ebdf9f2df2f3dbd23eb830b923",
    "hook-runner-global-aekT_Vmt.mjs": "ca375fb54738e2ef0946fb146dbd366cb500b7f837ee4d2287fc3b783cfc0dae",
    "setup-4a_QaRYo.mjs": "b41bb1885b56dda1616b9378f6744b08c9acecf1816282fe4ea79a9f8861c439",
}

# Pinned SHA256 hashes of the exact patched host files
PATCHED_HASHES = {
    "agent-runner-utils-Bd5FUrZ1.mjs": "b8cdd7b4b7130ac8659c6df0dd80e4f5ee0c50610a993c87899ed903663b7230",
    "attempt-execution-crM9pZWL.mjs": "0c181381871f8d2cce6c83be314ad85b637e8a199e3fe957057a9a34135a4ce3",
    "embedded-agent-DNQn_PMM.mjs": "99e843cd0248ff1d34fc08905347edeff1efb39e21658fc8ebeee04a49949193",
    "hook-runner-global-aekT_Vmt.mjs": "578e42d1ba183afc989a6d762d94553d3d80df6a2013df23a72c568de3ae4230",
    "setup-4a_QaRYo.mjs": "de419e12494a6a805c4c59b18dd84469361e3758b8302be5497697c41d9c1016",
}

BACKUP_DIRNAME = ".openclaw-compat-backup"

# Exact search and replacement transformations
PATCH_TRANSFORMS = {
    "hook-runner-global-aekT_Vmt.mjs": [
        (
            "\tconst mergeBeforeModelResolve = (acc, next) => ({\n"
            "\t\tmodelOverride: firstDefined(acc?.modelOverride, next.modelOverride),\n"
            "\t\tproviderOverride: firstDefined(acc?.providerOverride, next.providerOverride)\n"
            "\t});",
            "\tconst mergeBeforeModelResolve = (acc, next) => ({\n"
            "\t\tmodelOverride: firstDefined(acc?.modelOverride, next.modelOverride),\n"
            "\t\tproviderOverride: firstDefined(acc?.providerOverride, next.providerOverride),\n"
            "\t\tthinkingOverride: firstDefined(acc?.thinkingOverride, next.thinkingOverride)\n"
            "\t});",
        ),
    ],
    "setup-4a_QaRYo.mjs": [
        (
            "\tif (hookRunner?.hasHooks(\"before_model_resolve\")) try {\n"
            "\t\tconst event = params.attachments ? {\n"
            "\t\t\tprompt: params.prompt,\n"
            "\t\t\tattachments: params.attachments\n"
            "\t\t} : { prompt: params.prompt };\n"
            "\t\tmodelResolveOverride = await hookRunner.runBeforeModelResolve(event, params.hookContext);\n"
            "\t} catch (hookErr) {\n"
            "\t\tlog.warn(`before_model_resolve hook failed: ${String(hookErr)}`);\n"
            "\t}\n"
            "\tif (modelResolveOverride?.providerOverride) {\n"
            "\t\tprovider = modelResolveOverride.providerOverride;\n"
            "\t\tlog.info(`[hooks] provider overridden to ${provider}`);\n"
            "\t}\n"
            "\tif (modelResolveOverride?.modelOverride) {\n"
            "\t\tmodelId = modelResolveOverride.modelOverride;\n"
            "\t\tlog.info(`[hooks] model overridden to ${modelId}`);\n"
            "\t}\n"
            "\treturn {\n"
            "\t\tprovider,\n"
            "\t\tmodelId\n"
            "\t};",
            "\tconst thinkingExplicit = params.thinkingExplicit !== void 0 ? Boolean(params.thinkingExplicit) : params.thinkLevelOverride !== void 0;\n"
            "\tconst modelExplicit = Boolean(params.modelExplicit);\n"
            "\tconst isFallbackRetry = Boolean(params.isFallbackRetry);\n"
            "\tif (hookRunner?.hasHooks(\"before_model_resolve\")) try {\n"
            "\t\tconst event = params.attachments ? {\n"
            "\t\t\tprompt: params.prompt,\n"
            "\t\t\tattachments: params.attachments,\n"
            "\t\t\troutingThinkingSupported: true,\n"
            "\t\t\tthinkingExplicit,\n"
            "\t\t\tmodelExplicit,\n"
            "\t\t\tisFallbackRetry\n"
            "\t\t} : {\n"
            "\t\t\tprompt: params.prompt,\n"
            "\t\t\troutingThinkingSupported: true,\n"
            "\t\t\tthinkingExplicit,\n"
            "\t\t\tmodelExplicit,\n"
            "\t\t\tisFallbackRetry\n"
            "\t\t};\n"
            "\t\tmodelResolveOverride = await hookRunner.runBeforeModelResolve(event, params.hookContext);\n"
            "\t} catch (hookErr) {\n"
            "\t\tlog.warn(`before_model_resolve hook failed: ${String(hookErr)}`);\n"
            "\t}\n"
            "\tif (modelResolveOverride?.providerOverride && !modelExplicit) {\n"
            "\t\tprovider = modelResolveOverride.providerOverride;\n"
            "\t\tlog.info(`[hooks] provider overridden to ${provider}`);\n"
            "\t}\n"
            "\tif (modelResolveOverride?.modelOverride && !modelExplicit) {\n"
            "\t\tmodelId = modelResolveOverride.modelOverride;\n"
            "\t\tlog.info(`[hooks] model overridden to ${modelId}`);\n"
            "\t}\n"
            "\tlet thinkingOverride;\n"
            "\tconst hasExplicitThinking = thinkingExplicit || params.thinkLevelOverride !== void 0;\n"
            "\tif (modelResolveOverride?.thinkingOverride !== void 0 && !hasExplicitThinking) {\n"
            "\t\tconst rawThinking = String(modelResolveOverride.thinkingOverride).trim().toLowerCase();\n"
            "\t\tif (rawThinking === \"low\" || rawThinking === \"medium\" || rawThinking === \"high\" || rawThinking === \"max\") {\n"
            "\t\t\tthinkingOverride = rawThinking;\n"
            "\t\t\tlog.info(`[hooks] thinking overridden to ${thinkingOverride}`);\n"
            "\t\t} else {\n"
            "\t\t\tlog.warn(`[hooks] invalid thinking override ignored: ${modelResolveOverride.thinkingOverride}`);\n"
            "\t\t}\n"
            "\t}\n"
            "\treturn {\n"
            "\t\tprovider,\n"
            "\t\tmodelId,\n"
            "\t\t...thinkingOverride !== void 0 ? { thinkingOverride } : {}\n"
            "\t};",
        ),
    ],
    "embedded-agent-DNQn_PMM.mjs": [
        (
            "\tconst hookSelection = await resolveHookModelSelection({\n"
            "\t\tprompt: runParams.prompt,\n"
            "\t\tattachments: buildBeforeModelResolveAttachments(runParams.images),\n"
            "\t\tprovider: params.provider,\n"
            "\t\tmodelId: params.modelId,\n"
            "\t\tmodelSelectionLocked: runParams.modelSelectionLocked,\n"
            "\t\thookRunner: params.hookRunner,\n"
            "\t\thookContext: params.hookContext\n"
            "\t});",
            "\tconst hookSelection = await resolveHookModelSelection({\n"
            "\t\tprompt: runParams.prompt,\n"
            "\t\tattachments: buildBeforeModelResolveAttachments(runParams.images),\n"
            "\t\tprovider: params.provider,\n"
            "\t\tmodelId: params.modelId,\n"
            "\t\tmodelSelectionLocked: runParams.modelSelectionLocked,\n"
            "\t\tthinkLevelOverride: runParams.thinkLevelOverride,\n"
            "\t\tthinkingExplicit: runParams.thinkingExplicit,\n"
            "\t\tmodelExplicit: runParams.modelExplicit,\n"
            "\t\tisFallbackRetry: runParams.isFallbackRetry,\n"
            "\t\thookRunner: params.hookRunner,\n"
            "\t\thookContext: params.hookContext\n"
            "\t});",
        ),
        (
            "\t\tmodelConfigProvider,\n"
            "\t\tmodel,\n"
            "\t\tauthStorage,\n"
            "\t\tmodelRegistry\n"
            "\t};\n"
            "}",
            "\t\tmodelConfigProvider,\n"
            "\t\tmodel,\n"
            "\t\tauthStorage,\n"
            "\t\tmodelRegistry,\n"
            "\t\t...hookSelection?.thinkingOverride !== void 0 ? { thinkingOverride: hookSelection.thinkingOverride } : {}\n"
            "\t};\n"
            "}",
        ),
        (
            "\tconst { requestedModelId, modelSelectionChangedByHook, requestStreamTransportOverrides, expectedHarnessArtifact, pinnedHarnessId, nativeModelOwned, nativeSessionRuntime, modelConfigProvider, model, authStorage, modelRegistry } = modelSetup;",
            "\tconst { requestedModelId, modelSelectionChangedByHook, requestStreamTransportOverrides, expectedHarnessArtifact, pinnedHarnessId, nativeModelOwned, nativeSessionRuntime, modelConfigProvider, model, authStorage, modelRegistry, thinkingOverride } = modelSetup;",
        ),
        (
            "\tconst requestedThinkLevel = resolveInitialThinkLevel({\n"
            "\t\trequested: params.thinkLevel,\n"
            "\t\tconfig: params.config,\n"
            "\t\tprovider,\n"
            "\t\tmodelId,\n"
            "\t\tmodel: models.effective\n"
            "\t});\n"
            "\tconst initialThinkLevel = modelSelectionChangedByHook ? resolveCandidateThinkingLevel({\n"
            "\t\tcfg: params.config,\n"
            "\t\tprovider,\n"
            "\t\tmodelId,\n"
            "\t\tlevel: requestedThinkLevel,\n"
            "\t\tcatalog: [{\n"
            "\t\t\tprovider,\n"
            "\t\t\tid: modelId,\n"
            "\t\t\tapi: models.effective.api,\n"
            "\t\t\treasoning: models.effective.reasoning,\n"
            "\t\t\tparams: models.effective.params,\n"
            "\t\t\tcompat: models.effective.compat\n"
            "\t\t}],\n"
            "\t\tagentId: params.agentId,\n"
            "\t\tsessionKey: params.sessionKey,\n"
            "\t\tagentRuntime: agentHarness.id\n"
            "\t}) ?? requestedThinkLevel : requestedThinkLevel;",
            "\tif (thinkingOverride && !params.thinkingExplicit && params.thinkLevelOverride === void 0) {\n"
            "\t\tparams.thinkLevel = thinkingOverride;\n"
            "\t}\n"
            "\tconst requestedThinkLevel = resolveInitialThinkLevel({\n"
            "\t\trequested: params.thinkLevel,\n"
            "\t\tconfig: params.config,\n"
            "\t\tprovider,\n"
            "\t\tmodelId,\n"
            "\t\tmodel: models.effective\n"
            "\t});\n"
            "\tconst initialThinkLevel = (modelSelectionChangedByHook || (thinkingOverride && !params.thinkingExplicit && params.thinkLevelOverride === void 0)) ? resolveCandidateThinkingLevel({\n"
            "\t\tcfg: params.config,\n"
            "\t\tprovider,\n"
            "\t\tmodelId,\n"
            "\t\tlevel: requestedThinkLevel,\n"
            "\t\tcatalog: [{\n"
            "\t\t\tprovider,\n"
            "\t\t\tid: modelId,\n"
            "\t\t\tapi: models.effective.api,\n"
            "\t\t\treasoning: models.effective.reasoning,\n"
            "\t\t\tparams: models.effective.params,\n"
            "\t\t\tcompat: models.effective.compat\n"
            "\t\t}],\n"
            "\t\tagentId: params.agentId,\n"
            "\t\tsessionKey: params.sessionKey,\n"
            "\t\tagentRuntime: agentHarness.id\n"
            "\t}) ?? requestedThinkLevel : requestedThinkLevel;",
        ),
    ],
    "agent-runner-utils-Bd5FUrZ1.mjs": [
        (
            "\t\t...params.authProfile,\n"
            "\t\tthinkLevel: params.run.thinkLevel,\n"
            "\t\tfastMode: params.run.fastMode,",
            "\t\t...params.authProfile,\n"
            "\t\tthinkLevel: params.run.thinkLevel,\n"
            "\t\tthinkLevelOverride: params.run.thinkLevelOverride,\n"
            "\t\t...Boolean(params.modelExplicit || params.run?.modelExplicit || (params.run?.hasSessionModelOverride && (params.run?.modelOverrideSource === \"user\" || (params.run?.modelOverrideSource !== \"auto\" && !params.run?.hasAutoFallbackProvenance)))) ? { modelExplicit: true } : {},\n"
            "\t\t...params.isFallbackRetry !== void 0 ? { isFallbackRetry: params.isFallbackRetry } : params.run?.isFallbackRetry !== void 0 ? { isFallbackRetry: params.run.isFallbackRetry } : {},\n"
            "\t\tfastMode: params.run.fastMode,",
        ),
    ],
    "attempt-execution-crM9pZWL.mjs": [
        (
            "\t\tauthProfileId,\n"
            "\t\tauthProfileIdSource: authProfileId ? harnessAuthSelection.authProfileIdSource : void 0,\n"
            "\t\tthinkLevel: params.resolvedThinkLevel,\n"
            "\t\tfastMode: params.fastMode,",
            "\t\tauthProfileId,\n"
            "\t\tauthProfileIdSource: authProfileId ? harnessAuthSelection.authProfileIdSource : void 0,\n"
            "\t\tthinkLevel: params.resolvedThinkLevel,\n"
            "\t\tthinkingExplicit: Boolean(params.opts.thinkingOnce || params.opts.thinking),\n"
            "\t\tmodelExplicit: Boolean(params.opts.model || params.opts.provider),\n"
            "\t\tisFallbackRetry: params.isFallbackRetry,\n"
            "\t\tfastMode: params.fastMode,",
        ),
    ],
}


def compute_sha256(file_path: Path) -> str:
    """Compute hex sha256 digest of file."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def resolve_target_dir(root_path: Path) -> Path:
    """Resolve directory containing the target host files."""
    if not root_path.exists():
        raise FileNotFoundError(f"Target path does not exist: {root_path}")

    # Check if files are directly in root_path
    if all((root_path / fname).is_file() for fname in ORIGINAL_HASHES):
        return root_path

    # Check if files are in dist/ subdirectory
    dist_dir = root_path / "dist"
    if dist_dir.is_dir() and all((dist_dir / fname).is_file() for fname in ORIGINAL_HASHES):
        return dist_dir

    raise FileNotFoundError(
        f"Could not find all required OpenClaw host files in {root_path} or {dist_dir}."
    )


def inspect_files(target_dir: Path):
    """Inspect all target files and return status dict."""
    status = {}
    for fname, orig_hash in ORIGINAL_HASHES.items():
        fpath = target_dir / fname
        if not fpath.is_file():
            status[fname] = {"state": "missing", "path": fpath, "hash": None}
            continue
        current_hash = compute_sha256(fpath)
        patched_hash = PATCHED_HASHES[fname]
        if current_hash == orig_hash:
            state = "original"
        elif current_hash == patched_hash:
            state = "patched"
        else:
            state = "mismatch"
        status[fname] = {
            "state": state,
            "path": fpath,
            "current_hash": current_hash,
            "original_hash": orig_hash,
            "patched_hash": patched_hash,
        }
    return status


def check_command(target_dir: Path) -> int:
    """Execute --check action."""
    status = inspect_files(target_dir)
    all_original = all(info["state"] == "original" for info in status.values())
    all_patched = all(info["state"] == "patched" for info in status.values())

    print(f"OpenClaw host directory: {target_dir}")
    print("-" * 60)
    for fname, info in status.items():
        print(f"  {fname}: {info['state']} (hash: {info.get('current_hash', 'N/A')[:16]}...)")
    print("-" * 60)

    if all_patched:
        print("STATUS: PATCHED (All files match exact patched hashes)")
        return 0
    if all_original:
        print("STATUS: UNPATCHED (All files match exact original OpenClaw 2026.9.3 hashes)")
        return 0

    print("STATUS: MISMATCH / PARTIAL STATE (Refusing operation)", file=sys.stderr)
    return 1


def apply_command(target_dir: Path) -> int:
    """Execute --apply action with preflight, backup, and transactional write."""
    status = inspect_files(target_dir)

    # 1. Idempotency check: if all already patched, succeed immediately
    if all(info["state"] == "patched" for info in status.values()):
        print("STATUS: ALREADY PATCHED (All files already match expected patched hashes; idempotent no-op).")
        return 0

    # 2. Preflight guard: refuse if any file is not original
    if any(info["state"] == "missing" for info in status.values()):
        print("ERROR: One or more target files are missing.", file=sys.stderr)
        return 1

    if any(info["state"] == "mismatch" for info in status.values()):
        print("ERROR: Preflight check failed! One or more files have unexpected content/hash mismatch.", file=sys.stderr)
        for fname, info in status.items():
            if info["state"] == "mismatch":
                print(f"  {fname}: got {info['current_hash']}, expected original {info['original_hash']} or patched {info['patched_hash']}", file=sys.stderr)
        return 1

    if any(info["state"] == "patched" for info in status.values()):
        # Mixed state: some patched, some original
        print("ERROR: Preflight check failed! Host files are in a mixed partial state.", file=sys.stderr)
        return 1

    # 3. Dedicated backup directory: do not overwrite prior backup if already valid
    backup_dir = target_dir / BACKUP_DIRNAME
    if backup_dir.exists():
        # Validate existing backup
        backup_valid = True
        for fname, orig_hash in ORIGINAL_HASHES.items():
            bf = backup_dir / fname
            if not bf.is_file() or compute_sha256(bf) != orig_hash:
                backup_valid = False
                break
        if not backup_valid:
            print(f"ERROR: Existing backup directory {backup_dir} is invalid or corrupted. Aborting to preserve safety.", file=sys.stderr)
            return 1
        print(f"Verified existing valid backup in {backup_dir} (preserving without overwrite).")
    else:
        # Create dedicated backup directory and copy originals
        backup_dir.mkdir(parents=True, exist_ok=False)
        try:
            for fname, orig_hash in ORIGINAL_HASHES.items():
                src = target_dir / fname
                dst = backup_dir / fname
                shutil.copy2(src, dst)
                if compute_sha256(dst) != orig_hash:
                    raise IOError(f"Backup validation failed for {fname}")
            print(f"Created and validated original backups in {backup_dir}.")
        except Exception as e:
            print(f"ERROR: Failed to create valid backup: {e}", file=sys.stderr)
            if backup_dir.exists():
                shutil.rmtree(backup_dir, ignore_errors=True)
            return 1

    # 4. Prepare patched content in memory
    patched_contents = {}
    try:
        for fname, transforms in PATCH_TRANSFORMS.items():
            src_path = target_dir / fname
            with open(src_path, "r", encoding="utf-8") as f:
                content = f.read()

            for target_text, repl_text in transforms:
                if target_text not in content:
                    raise ValueError(f"Could not find patch target pattern in {fname}")
                content = content.replace(target_text, repl_text, 1)

            # Pre-verify patched content hash
            content_bytes = content.encode("utf-8")
            actual_hash = hashlib.sha256(content_bytes).hexdigest()
            expected_hash = PATCHED_HASHES[fname]
            if actual_hash != expected_hash:
                raise ValueError(
                    f"Patched content hash mismatch for {fname}: got {actual_hash}, expected {expected_hash}"
                )
            patched_contents[fname] = content_bytes
    except Exception as e:
        print(f"ERROR during patch synthesis: {e}. No files were modified.", file=sys.stderr)
        return 1

    # 5. Transactional atomic write with rollback on failure
    written_files = []
    try:
        for fname, content_bytes in patched_contents.items():
            target_file = target_dir / fname
            # Write to temporary file in same directory for atomic replace
            fd, tmp_path_str = tempfile.mkstemp(prefix=f".{fname}.tmp.", dir=target_dir)
            tmp_path = Path(tmp_path_str)
            with os.fdopen(fd, "wb") as f:
                f.write(content_bytes)
                f.flush()
                os.fsync(f.fileno())

            # Atomic replace
            os.replace(tmp_path, target_file)
            written_files.append(fname)

        # Post-write validation
        for fname, expected_hash in PATCHED_HASHES.items():
            actual_hash = compute_sha256(target_dir / fname)
            if actual_hash != expected_hash:
                raise IOError(f"Post-write validation failed for {fname}: got {actual_hash}")

    except Exception as e:
        print(f"ERROR during patch writing: {e}. Rolling back all modifications from backup...", file=sys.stderr)
        for fname in ORIGINAL_HASHES:
            src = backup_dir / fname
            dst = target_dir / fname
            if src.is_file():
                shutil.copy2(src, dst)
        print("Rollback complete. Host remains in original state.", file=sys.stderr)
        return 1

    print("STATUS: SUCCESS. All compatibility patches applied and verified against pinned SHA256 hashes.")
    return 0


def restore_command(target_dir: Path) -> int:
    """Execute --restore action to return all host files to exact original state."""
    status = inspect_files(target_dir)

    # 1. Idempotency check: if all already original, succeed immediately
    if all(info["state"] == "original" for info in status.values()):
        print("STATUS: ALREADY ORIGINAL (All files already match expected original hashes; idempotent no-op).")
        return 0

    backup_dir = target_dir / BACKUP_DIRNAME
    # Validate backup availability
    if not backup_dir.is_dir():
        print(f"ERROR: Backup directory not found at {backup_dir}. Cannot restore safely.", file=sys.stderr)
        return 1

    for fname, orig_hash in ORIGINAL_HASHES.items():
        bf = backup_dir / fname
        if not bf.is_file() or compute_sha256(bf) != orig_hash:
            print(f"ERROR: Backup file {bf} is missing or corrupted. Refusing unsafe restore.", file=sys.stderr)
            return 1

    # Guard: if any file is in an unknown corrupted state (neither original nor patched), warn
    unexpected = [fname for fname, info in status.items() if info["state"] not in ("original", "patched")]
    if unexpected:
        print(f"Notice: Restoring {len(unexpected)} file(s) with unexpected/corrupted state using validated backup.")

    # Transactional restore
    try:
        for fname, orig_hash in ORIGINAL_HASHES.items():
            src = backup_dir / fname
            dst = target_dir / fname
            # Use atomic replace
            fd, tmp_path_str = tempfile.mkstemp(prefix=f".{fname}.restoretmp.", dir=target_dir)
            tmp_path = Path(tmp_path_str)
            with os.fdopen(fd, "wb") as f_out, open(src, "rb") as f_in:
                shutil.copyfileobj(f_in, f_out)
                f_out.flush()
                os.fsync(f_out.fileno())
            os.replace(tmp_path, dst)

        # Validate restored files
        for fname, orig_hash in ORIGINAL_HASHES.items():
            actual = compute_sha256(target_dir / fname)
            if actual != orig_hash:
                raise IOError(f"Restoration verification failed for {fname}: got {actual}, expected {orig_hash}")

    except Exception as e:
        print(f"ERROR during restore: {e}", file=sys.stderr)
        return 1

    print("STATUS: SUCCESS. All host files successfully restored to exact original OpenClaw 2026.9.3 state.")
    return 0


def main():
    parser = argparse.ArgumentParser(
        description="OpenClaw 2026.9.3 Compatibility Patcher for Model Router"
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--check", action="store_true", help="Check host compatibility and patch status")
    group.add_argument("--apply", action="store_true", help="Preflight, backup originals, and apply patches")
    group.add_argument("--restore", action="store_true", help="Restore host files to exact original state")

    parser.add_argument(
        "root_path",
        nargs="?",
        help="Path to OpenClaw host directory containing the target .mjs files",
    )
    parser.add_argument(
        "--root",
        dest="root_flag",
        help="Alternative flag for path to OpenClaw host directory",
    )

    args = parser.parse_args()

    raw_path = args.root_flag or args.root_path
    if not raw_path:
        parser.error("Must supply target OpenClaw root path as argument or with --root")

    target_path = Path(raw_path).resolve()

    try:
        target_dir = resolve_target_dir(target_path)
    except FileNotFoundError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

    if args.check:
        sys.exit(check_command(target_dir))
    elif args.apply:
        sys.exit(apply_command(target_dir))
    elif args.restore:
        sys.exit(restore_command(target_dir))


if __name__ == "__main__":
    main()
