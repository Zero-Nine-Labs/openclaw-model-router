import test, { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');
const COMPAT_PY = path.join(REPO_ROOT, 'fallback-notice-compat.py');
const FIXTURES_DIR = process.env.OPENCLAW_FALLBACK_FIXTURES;
if (!FIXTURES_DIR) throw new Error('Set OPENCLAW_FALLBACK_FIXTURES to the pinned original fallback runtime directory. See COMPATIBILITY.md.');
const TARGET_FILENAME = 'agent-runner.runtime-ChH8PGBC.mjs';

const ORIGINAL_HASH = '611f4dea79b1a3908a30de2ae155072e302f995259d13b578752b1b2fab309be';
const PATCHED_HASH = '5baeeffddbdb8c8d5d0c1f3cab190e98da2e4dcbe7d69865029345242aad5762';

function sha256(filePath) {
  const buf = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function runPython(args) {
  return spawnSync('python3', [COMPAT_PY, ...args], {
    encoding: 'utf-8',
  });
}

function createFixtureWorkspace() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-zn861-test-'));
  const src = path.join(FIXTURES_DIR, TARGET_FILENAME);
  const dst = path.join(tmpDir, TARGET_FILENAME);
  fs.copyFileSync(src, dst);
  return tmpDir;
}

function createMockSandbox() {
  return {
    normalizeOptionalString: (s) => (typeof s === 'string' && s.trim() ? s.trim() : undefined),
    hasSessionAutoModelFallbackProvenance: (e) =>
      Boolean(e?.hasAutoFallbackProvenance || e?.modelOverrideSource === 'auto'),
    formatProviderModelRef: (p, m) => (p && m ? `${p}/${m}` : (m || '')),
    areRuntimeModelRefsEquivalent: (a, b) => a === b,
    buildFallbackReasonSummary: (attempts) => {
      const first = attempts?.[0];
      return first
        ? (first.reason?.replace(/_/g, ' ') || first.code || first.error || 'error')
        : 'selected model unavailable';
    },
    buildFallbackAttemptSummaries: (attempts) => (attempts || []).map((a) => a.reason || 'attempt'),
  };
}

describe('ZN-861 Fallback Notice Compatibility Patcher (fallback-notice-compat.py)', () => {
  it('detects unpatched original fixture via --check', () => {
    const ws = createFixtureWorkspace();
    try {
      const res = runPython(['--check', ws]);
      assert.equal(res.status, 0, `Expected exit 0, got: ${res.stderr}`);
      assert.match(res.stdout, /STATUS: UNPATCHED/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('applies compatibility patch and validates patched hash, backup, and syntax', () => {
    const ws = createFixtureWorkspace();
    try {
      const res = runPython(['--apply', ws]);
      assert.equal(res.status, 0, `Expected exit 0, got: ${res.stderr}`);
      assert.match(res.stdout, /STATUS: SUCCESS/);

      // Verify backup directory exists and has original hash
      const backupDir = path.join(ws, '.openclaw-fallback-notice-backup');
      assert.ok(fs.existsSync(backupDir), 'Backup directory should exist');
      const bf = path.join(backupDir, TARGET_FILENAME);
      assert.ok(fs.existsSync(bf), 'Backup file should exist');
      assert.equal(sha256(bf), ORIGINAL_HASH, 'Backup hash mismatch');

      // Verify target file matches PATCHED_HASH
      const tf = path.join(ws, TARGET_FILENAME);
      assert.equal(sha256(tf), PATCHED_HASH, 'Patched file hash mismatch');

      // Verify syntax of patched file using node --check
      const checkRes = spawnSync('node', ['--check', tf], { encoding: 'utf-8' });
      assert.equal(checkRes.status, 0, `node --check failed: ${checkRes.stderr}`);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('is idempotent on repeated --apply', () => {
    const ws = createFixtureWorkspace();
    try {
      const res1 = runPython(['--apply', ws]);
      assert.equal(res1.status, 0);

      const res2 = runPython(['--apply', ws]);
      assert.equal(res2.status, 0);
      assert.match(res2.stdout, /STATUS: ALREADY PATCHED/);

      assert.equal(sha256(path.join(ws, TARGET_FILENAME)), PATCHED_HASH);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('reports patched state via --check after patching', () => {
    const ws = createFixtureWorkspace();
    try {
      runPython(['--apply', ws]);
      const res = runPython(['--check', ws]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /STATUS: PATCHED/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('restores original file via --restore and validates original hash', () => {
    const ws = createFixtureWorkspace();
    try {
      runPython(['--apply', ws]);
      const resRestore = runPython(['--restore', ws]);
      assert.equal(resRestore.status, 0, `Expected exit 0, got: ${resRestore.stderr}`);
      assert.match(resRestore.stdout, /STATUS: SUCCESS/);

      assert.equal(sha256(path.join(ws, TARGET_FILENAME)), ORIGINAL_HASH);

      const resCheck = runPython(['--check', ws]);
      assert.equal(resCheck.status, 0);
      assert.match(resCheck.stdout, /STATUS: UNPATCHED/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('is idempotent on repeated --restore', () => {
    const ws = createFixtureWorkspace();
    try {
      runPython(['--apply', ws]);
      runPython(['--restore', ws]);

      const res2 = runPython(['--restore', ws]);
      assert.equal(res2.status, 0);
      assert.match(res2.stdout, /STATUS: ALREADY ORIGINAL/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('rejects unexpected content / wrong hash on --apply without making edits', () => {
    const ws = createFixtureWorkspace();
    try {
      const corruptedFile = path.join(ws, TARGET_FILENAME);
      fs.appendFileSync(corruptedFile, '\n// foreign unexpected modification\n');
      const corruptHash = sha256(corruptedFile);

      const resApply = runPython(['--apply', ws]);
      assert.notEqual(resApply.status, 0, 'Should exit non-zero on unexpected content');
      assert.match(resApply.stderr, /Preflight check failed/);

      assert.equal(sha256(corruptedFile), corruptHash, 'Corrupted file must not be modified');

      const resCheck = runPython(['--check', ws]);
      assert.notEqual(resCheck.status, 0);
      assert.match(resCheck.stderr, /STATUS: MISMATCH/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('supports --root flag as well as positional root path', () => {
    const ws = createFixtureWorkspace();
    try {
      const res = runPython(['--check', '--root', ws]);
      assert.equal(res.status, 0);
      assert.match(res.stdout, /STATUS: UNPATCHED/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('resolves dist/ subdirectory when target is inside dist', () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-zn861-dist-'));
    try {
      const distDir = path.join(ws, 'dist');
      fs.mkdirSync(distDir, { recursive: true });
      fs.copyFileSync(path.join(FIXTURES_DIR, TARGET_FILENAME), path.join(distDir, TARGET_FILENAME));

      const resCheck = runPython(['--check', ws]);
      assert.equal(resCheck.status, 0);
      assert.match(resCheck.stdout, /STATUS: UNPATCHED/);

      const resApply = runPython(['--apply', ws]);
      assert.equal(resApply.status, 0);
      assert.equal(sha256(path.join(distDir, TARGET_FILENAME)), PATCHED_HASH);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });
});

describe('ZN-861 Callsite Verification (Extracted from Patched Host Source)', () => {
  let ws;
  let patchedContent;

  before(() => {
    ws = createFixtureWorkspace();
    const res = runPython(['--apply', ws]);
    assert.equal(res.status, 0);
    patchedContent = fs.readFileSync(path.join(ws, TARGET_FILENAME), 'utf-8');
  });

  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it('verifies exact changed callsite passes all required fields', () => {
    const callsiteMatch = patchedContent.match(
      /const configuredFallbackModel = resolveFallbackOriginModel\(\{[\s\S]*?\n\t\}\);/
    );
    assert.ok(callsiteMatch, 'resolveFallbackOriginModel callsite must exist in patched file');
    const callsiteCode = callsiteMatch[0];

    // Verify all required parameter fields are present in callsite expression
    assert.match(callsiteCode, /run:\s*followupRun\.run/);
    assert.match(callsiteCode, /fallbackStateEntry/);
    assert.match(callsiteCode, /runtimeModelSelection/);
    assert.match(callsiteCode, /executionTrace:\s*runResult\.meta\?\.executionTrace/);
    assert.match(callsiteCode, /fallbackAttempts/);
    assert.match(callsiteCode, /activeModel:\s*sessionModel/);

    // Execute extracted callsite expression in VM to verify parameter passing
    let capturedArgs = null;
    const testScope = {
      resolveFallbackOriginModel: (params) => {
        capturedArgs = params;
        return { provider: 'dummy', model: 'dummy' };
      },
      followupRun: {
        run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      },
      fallbackStateEntry: { someKey: 'val' },
      runtimeModelSelection: undefined,
      runResult: {
        meta: {
          executionTrace: {
            fallbackUsed: false,
            attempts: [{ provider: 'openai', model: 'gpt-5.6-luna', result: 'success' }],
          },
        },
      },
      fallbackAttempts: [],
      sessionModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    };

    vm.runInNewContext(callsiteCode, testScope);

    assert.ok(capturedArgs, 'resolveFallbackOriginModel must be invoked');
    assert.equal(capturedArgs.run, testScope.followupRun.run);
    assert.equal(capturedArgs.fallbackStateEntry, testScope.fallbackStateEntry);
    assert.equal(capturedArgs.runtimeModelSelection, undefined);
    assert.equal(capturedArgs.executionTrace, testScope.runResult.meta.executionTrace);
    assert.deepEqual(capturedArgs.fallbackAttempts, []);
    assert.equal(capturedArgs.activeModel, testScope.sessionModel);
  });
});

describe('ZN-861 False Fallback Notice Reproduction and Fix Verification', () => {
  let ws;
  let origResolve;
  let patchedResolve;
  let resolveTransition;
  let buildNotice;

  before(() => {
    ws = createFixtureWorkspace();
    const origContent = fs.readFileSync(path.join(ws, TARGET_FILENAME), 'utf-8');
    const origFnMatch = origContent.match(/function resolveFallbackOriginModel\(params\) \{[\s\S]*?\n\}/);
    const transMatch = origContent.match(/function resolveFallbackTransition\(params\) \{[\s\S]*?\n\}/);
    const noticeMatch = origContent.match(/function buildFallbackNotice\(params\) \{[\s\S]*?\n\}/);

    assert.ok(origFnMatch, 'Original resolveFallbackOriginModel must be extractable');
    assert.ok(transMatch, 'resolveFallbackTransition must be extractable');
    assert.ok(noticeMatch, 'buildFallbackNotice must be extractable');

    // Apply patch to workspace
    const res = runPython(['--apply', ws]);
    assert.equal(res.status, 0);
    const patchedContent = fs.readFileSync(path.join(ws, TARGET_FILENAME), 'utf-8');
    const patchedFnMatch = patchedContent.match(/function resolveFallbackOriginModel\(params\) \{[\s\S]*?\n\}/);
    assert.ok(patchedFnMatch, 'Patched resolveFallbackOriginModel must be extractable');

    // Set up sandboxes
    const sbOrig = createMockSandbox();
    vm.runInNewContext(
      `${origFnMatch[0]};\n${transMatch[0]};\n${noticeMatch[0]};\n` +
        'out = { resolve: resolveFallbackOriginModel, trans: resolveFallbackTransition, notice: buildFallbackNotice };',
      sbOrig
    );
    origResolve = sbOrig.out.resolve;

    const sbPatched = createMockSandbox();
    vm.runInNewContext(
      `${patchedFnMatch[0]};\n${transMatch[0]};\n${noticeMatch[0]};\n` +
        'out = { resolve: resolveFallbackOriginModel, trans: resolveFallbackTransition, notice: buildFallbackNotice };',
      sbPatched
    );
    patchedResolve = sbPatched.out.resolve;
    resolveTransition = sbPatched.out.trans;
    buildNotice = sbPatched.out.notice;
  });

  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it('reproduces exact original false notification and verifies patched selected origin yields no notice', () => {
    // Baseline real run: configured Sol, intentional hook selected Luna, successful no fallback
    const runParams = {
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      fallbackStateEntry: undefined,
      runtimeModelSelection: undefined,
      executionTrace: {
        fallbackUsed: false,
        attempts: [{ provider: 'openai', model: 'gpt-5.6-luna', result: 'success', stage: 'assistant' }],
      },
      fallbackAttempts: [],
      activeModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    };

    // 1. ORIGINAL behavior: returns configured Sol as fallback origin
    const origOrigin = origResolve(runParams);
    assert.equal(origOrigin.provider, 'openrouter');
    assert.equal(origOrigin.model, 'anthropic/claude-sonnet-4');
    assert.equal(origOrigin.persistedAutoFallback, false);

    // Transition comparison with active model Luna produces false fallback
    const origTransition = resolveTransition({
      selectedProvider: origOrigin.provider,
      selectedModel: origOrigin.model,
      activeProvider: runParams.activeModel.provider,
      activeModel: runParams.activeModel.model,
      attempts: runParams.fallbackAttempts,
      state: undefined,
      cfg: {},
    });
    assert.equal(origTransition.fallbackActive, true, 'Original emits false active fallback');
    assert.equal(
      origTransition.reasonSummary,
      'selected model unavailable',
      'Original emits selected model unavailable despite 0 attempts'
    );

    const origNoticeText = buildNotice({
      selectedProvider: origOrigin.provider,
      selectedModel: origOrigin.model,
      activeProvider: runParams.activeModel.provider,
      activeModel: runParams.activeModel.model,
      attempts: runParams.fallbackAttempts,
      cfg: {},
    });
    assert.match(
      origNoticeText,
      /↪️ Model Fallback: openai\/gpt-5\.6-luna \(selected openrouter\/anthropic\/claude-sonnet-4; selected model unavailable\)/,
      'Original produces false user-facing notice'
    );

    // 2. PATCHED behavior: returns intentional active selection Luna as origin
    const patchedOrigin = patchedResolve(runParams);
    assert.equal(patchedOrigin.provider, 'openai');
    assert.equal(patchedOrigin.model, 'gpt-5.6-luna');
    assert.equal(patchedOrigin.persistedAutoFallback, false);

    // Transition comparison with active model Luna produces NO fallback notice
    const patchedTransition = resolveTransition({
      selectedProvider: patchedOrigin.provider,
      selectedModel: patchedOrigin.model,
      activeProvider: runParams.activeModel.provider,
      activeModel: runParams.activeModel.model,
      attempts: runParams.fallbackAttempts,
      state: undefined,
      cfg: {},
    });
    assert.equal(patchedTransition.fallbackActive, false, 'Patched must not have active fallback');
    assert.equal(patchedTransition.stateChanged, false, 'Patched must not change fallback state');

    const patchedNoticeText = buildNotice({
      selectedProvider: patchedOrigin.provider,
      selectedModel: patchedOrigin.model,
      activeProvider: runParams.activeModel.provider,
      activeModel: runParams.activeModel.model,
      attempts: runParams.fallbackAttempts,
      cfg: {},
    });
    assert.equal(patchedNoticeText, null, 'Patched yields no notice');
  });

  it('case: genuine model_not_found failure preserves configured origin and real error reason', () => {
    const attempts = [
      { provider: 'openrouter', model: 'anthropic/claude-sonnet-4', reason: 'model_not_found' },
    ];
    const origin = patchedResolve({
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      executionTrace: { fallbackUsed: true, attempts },
      fallbackAttempts: attempts,
      activeModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    });
    // Must NOT infer intentional selection; must keep configured Sol
    assert.equal(origin.provider, 'openrouter');
    assert.equal(origin.model, 'anthropic/claude-sonnet-4');
    assert.equal(origin.persistedAutoFallback, false);

    const transition = resolveTransition({
      selectedProvider: origin.provider,
      selectedModel: origin.model,
      activeProvider: 'openai',
      activeModel: 'gpt-5.6-luna',
      attempts,
      state: undefined,
      cfg: {},
    });
    assert.equal(transition.fallbackActive, true);
    assert.equal(transition.reasonSummary, 'model not found');
  });

  it('case: genuine rate_limit failure preserves configured origin and real error reason', () => {
    const attempts = [
      { provider: 'openrouter', model: 'anthropic/claude-sonnet-4', reason: 'rate_limit' },
    ];
    const origin = patchedResolve({
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      executionTrace: { fallbackUsed: true, attempts },
      fallbackAttempts: attempts,
      activeModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    });
    assert.equal(origin.provider, 'openrouter');
    assert.equal(origin.model, 'anthropic/claude-sonnet-4');

    const transition = resolveTransition({
      selectedProvider: origin.provider,
      selectedModel: origin.model,
      activeProvider: 'openai',
      activeModel: 'gpt-5.6-luna',
      attempts,
      state: undefined,
      cfg: {},
    });
    assert.equal(transition.fallbackActive, true);
    assert.equal(transition.reasonSummary, 'rate limit');
  });

  it('case: persisted auto fallback retains configured fallback origin even without new attempts', () => {
    const origin = patchedResolve({
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      fallbackStateEntry: {
        modelOverrideSource: 'auto',
        modelOverrideFallbackOriginProvider: 'openrouter',
        modelOverrideFallbackOriginModel: 'anthropic/claude-sonnet-4',
      },
      executionTrace: { fallbackUsed: false, attempts: [{ provider: 'openai', model: 'gpt-5.6-luna', result: 'success' }] },
      fallbackAttempts: [],
      activeModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    });
    // Persisted auto fallback must evaluate FIRST
    assert.equal(origin.provider, 'openrouter');
    assert.equal(origin.model, 'anthropic/claude-sonnet-4');
    assert.equal(origin.persistedAutoFallback, true);
  });

  it('case: native runtime selection takes precedence over executionTrace', () => {
    const origin = patchedResolve({
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      runtimeModelSelection: { provider: 'anthropic', model: 'claude-3-haiku' },
      executionTrace: { fallbackUsed: false },
      fallbackAttempts: [],
      activeModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    });
    assert.equal(origin.provider, 'anthropic');
    assert.equal(origin.model, 'claude-3-haiku');
    assert.equal(origin.persistedAutoFallback, false);
  });

  it('case: absent trace leaves configured model unchanged', () => {
    const origin = patchedResolve({
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      executionTrace: undefined,
      fallbackAttempts: [],
      activeModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    });
    assert.equal(origin.provider, 'openrouter');
    assert.equal(origin.model, 'anthropic/claude-sonnet-4');
    assert.equal(origin.persistedAutoFallback, false);
  });

  it('case: stale false notice clears when successful intentional selection runs', () => {
    const previousState = {
      fallbackNotice: {
        selectedModel: 'openrouter/anthropic/claude-sonnet-4',
        activeModel: 'openai/gpt-5.6-luna',
        reason: 'selected model unavailable',
      },
    };

    const origin = patchedResolve({
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      fallbackStateEntry: previousState,
      executionTrace: { fallbackUsed: false, attempts: [{ provider: 'openai', model: 'gpt-5.6-luna', result: 'success' }] },
      fallbackAttempts: [],
      activeModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    });
    assert.equal(origin.provider, 'openai');
    assert.equal(origin.model, 'gpt-5.6-luna');

    const transition = resolveTransition({
      selectedProvider: origin.provider,
      selectedModel: origin.model,
      activeProvider: 'openai',
      activeModel: 'gpt-5.6-luna',
      attempts: [],
      state: previousState,
      cfg: {},
    });
    assert.equal(transition.fallbackActive, false);
    assert.equal(transition.fallbackCleared, true, 'Stale notice must be marked cleared');
    assert.equal(transition.stateChanged, true, 'State change must be triggered to wipe stale notice');
    assert.equal(transition.nextState.selectedModel, undefined);
    assert.equal(transition.nextState.activeModel, undefined);
    assert.equal(transition.nextState.reason, undefined);
  });

  it('case: unchanged same model produces no active fallback and no state change', () => {
    const origin = patchedResolve({
      run: { provider: 'openai', model: 'gpt-5.6-luna' },
      executionTrace: { fallbackUsed: false },
      fallbackAttempts: [],
      activeModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    });
    assert.equal(origin.provider, 'openai');
    assert.equal(origin.model, 'gpt-5.6-luna');

    const transition = resolveTransition({
      selectedProvider: origin.provider,
      selectedModel: origin.model,
      activeProvider: 'openai',
      activeModel: 'gpt-5.6-luna',
      attempts: [],
      state: undefined,
      cfg: {},
    });
    assert.equal(transition.fallbackActive, false);
    assert.equal(transition.stateChanged, false);
  });

  it('case: invalid or missing activeModel fields fall through to configured model', () => {
    // Missing activeModel
    const origin1 = patchedResolve({
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      executionTrace: { fallbackUsed: false },
      fallbackAttempts: [],
      activeModel: undefined,
    });
    assert.equal(origin1.provider, 'openrouter');
    assert.equal(origin1.model, 'anthropic/claude-sonnet-4');

    // Blank/whitespace provider
    const origin2 = patchedResolve({
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      executionTrace: { fallbackUsed: false },
      fallbackAttempts: [],
      activeModel: { provider: '   ', model: 'gpt-5.6-luna' },
    });
    assert.equal(origin2.provider, 'openrouter');
    assert.equal(origin2.model, 'anthropic/claude-sonnet-4');

    // Non-empty fallbackAttempts
    const origin3 = patchedResolve({
      run: { provider: 'openrouter', model: 'anthropic/claude-sonnet-4' },
      executionTrace: { fallbackUsed: false },
      fallbackAttempts: [{ provider: 'openrouter', model: 'anthropic/claude-sonnet-4' }],
      activeModel: { provider: 'openai', model: 'gpt-5.6-luna' },
    });
    assert.equal(origin3.provider, 'openrouter');
    assert.equal(origin3.model, 'anthropic/claude-sonnet-4');
  });
});
