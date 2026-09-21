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
const COMPAT_PY = path.join(REPO_ROOT, 'compat.py');
const FIXTURES_DIR = process.env.OPENCLAW_ROUTER_FIXTURES;
if (!FIXTURES_DIR) throw new Error('Set OPENCLAW_ROUTER_FIXTURES to the directory containing the five pinned original runtime files. See COMPATIBILITY.md.');

const ORIGINAL_HASHES = {
  'agent-runner-utils-Bd5FUrZ1.mjs': 'a34aa689dbb100a5562dae4872bc4be4be26650017cbe5b19ae0919a80d542bb',
  'attempt-execution-crM9pZWL.mjs': '4e521234c4799e69d6040a8d58ad896568b9279c977d1337b80ba4de2e7a98dd',
  'embedded-agent-DNQn_PMM.mjs': '21a919ebd72def44cdb3a5df6d558da2e0db48ebdf9f2df2f3dbd23eb830b923',
  'hook-runner-global-aekT_Vmt.mjs': 'ca375fb54738e2ef0946fb146dbd366cb500b7f837ee4d2287fc3b783cfc0dae',
  'setup-4a_QaRYo.mjs': 'b41bb1885b56dda1616b9378f6744b08c9acecf1816282fe4ea79a9f8861c439',
};

const PATCHED_HASHES = {
  'agent-runner-utils-Bd5FUrZ1.mjs': 'b8cdd7b4b7130ac8659c6df0dd80e4f5ee0c50610a993c87899ed903663b7230',
  'attempt-execution-crM9pZWL.mjs': '0c181381871f8d2cce6c83be314ad85b637e8a199e3fe957057a9a34135a4ce3',
  'embedded-agent-DNQn_PMM.mjs': '99e843cd0248ff1d34fc08905347edeff1efb39e21658fc8ebeee04a49949193',
  'hook-runner-global-aekT_Vmt.mjs': '578e42d1ba183afc989a6d762d94553d3d80df6a2013df23a72c568de3ae4230',
  'setup-4a_QaRYo.mjs': 'de419e12494a6a805c4c59b18dd84469361e3758b8302be5497697c41d9c1016',
};

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
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openclaw-compat-test-'));
  for (const filename of Object.keys(ORIGINAL_HASHES)) {
    const src = path.join(FIXTURES_DIR, filename);
    const dst = path.join(tmpDir, filename);
    fs.copyFileSync(src, dst);
  }
  return tmpDir;
}

function makeDummyProxy() {
  return new Proxy(() => {}, {
    get: (target, prop) => {
      if (prop === 'then') return undefined;
      if (prop === Symbol.toPrimitive) return () => '';
      return makeDummyProxy();
    },
    apply: () => makeDummyProxy(),
  });
}

describe('OpenClaw Compatibility Patcher (compat.py)', () => {
  it('detects unpatched original fixtures via --check', () => {
    const ws = createFixtureWorkspace();
    try {
      const res = runPython(['--check', ws]);
      assert.equal(res.status, 0, `Expected exit 0, got: ${res.stderr}`);
      assert.match(res.stdout, /STATUS: UNPATCHED/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('applies compatibility patches and validates patched hashes and backup', () => {
    const ws = createFixtureWorkspace();
    try {
      const res = runPython(['--apply', ws]);
      assert.equal(res.status, 0, `Expected exit 0, got: ${res.stderr}`);
      assert.match(res.stdout, /STATUS: SUCCESS/);

      // Verify backup directory exists and has original hashes
      const backupDir = path.join(ws, '.openclaw-compat-backup');
      assert.ok(fs.existsSync(backupDir), 'Backup directory should exist');
      for (const [fname, origHash] of Object.entries(ORIGINAL_HASHES)) {
        const bf = path.join(backupDir, fname);
        assert.ok(fs.existsSync(bf), `Backup file ${fname} should exist`);
        assert.equal(sha256(bf), origHash, `Backup file ${fname} hash mismatch`);
      }

      // Verify target files now match PATCHED_HASHES
      for (const [fname, patchedHash] of Object.entries(PATCHED_HASHES)) {
        const tf = path.join(ws, fname);
        assert.equal(sha256(tf), patchedHash, `Patched file ${fname} hash mismatch`);
      }

      // Verify syntax of all 5 patched files using node --check
      for (const fname of Object.keys(PATCHED_HASHES)) {
        const checkRes = spawnSync('node', ['--check', path.join(ws, fname)], { encoding: 'utf-8' });
        assert.equal(checkRes.status, 0, `node --check failed for ${fname}: ${checkRes.stderr}`);
      }
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('is idempotent on repeated --apply', () => {
    const ws = createFixtureWorkspace();
    try {
      // First apply
      const res1 = runPython(['--apply', ws]);
      assert.equal(res1.status, 0);

      // Second apply (should be idempotent no-op)
      const res2 = runPython(['--apply', ws]);
      assert.equal(res2.status, 0);
      assert.match(res2.stdout, /STATUS: ALREADY PATCHED/);

      // Verify files still match patched hashes
      for (const [fname, patchedHash] of Object.entries(PATCHED_HASHES)) {
        assert.equal(sha256(path.join(ws, fname)), patchedHash);
      }
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

  it('restores original files via --restore and validates original hashes', () => {
    const ws = createFixtureWorkspace();
    try {
      runPython(['--apply', ws]);
      const resRestore = runPython(['--restore', ws]);
      assert.equal(resRestore.status, 0, `Expected exit 0, got: ${resRestore.stderr}`);
      assert.match(resRestore.stdout, /STATUS: SUCCESS/);

      // Verify all files match ORIGINAL_HASHES
      for (const [fname, origHash] of Object.entries(ORIGINAL_HASHES)) {
        assert.equal(sha256(path.join(ws, fname)), origHash, `Restored file ${fname} mismatch`);
      }

      // Verify --check confirms unpatched
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

      // Repeated restore
      const res2 = runPython(['--restore', ws]);
      assert.equal(res2.status, 0);
      assert.match(res2.stdout, /STATUS: ALREADY ORIGINAL/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('rejects unexpected content on --apply without making any edits', () => {
    const ws = createFixtureWorkspace();
    try {
      // Corrupt one file
      const corruptedFile = path.join(ws, 'setup-4a_QaRYo.mjs');
      fs.appendFileSync(corruptedFile, '\n// unexpected foreign modification\n');
      const corruptHash = sha256(corruptedFile);

      // Try apply
      const resApply = runPython(['--apply', ws]);
      assert.notEqual(resApply.status, 0, 'Should exit non-zero on unexpected content');
      assert.match(resApply.stderr, /Preflight check failed/);

      // Verify corrupted file was not touched
      assert.equal(sha256(corruptedFile), corruptHash, 'Corrupted file should not be modified');

      // Verify other files were not touched
      for (const [fname, origHash] of Object.entries(ORIGINAL_HASHES)) {
        if (fname !== 'setup-4a_QaRYo.mjs') {
          assert.equal(sha256(path.join(ws, fname)), origHash, `File ${fname} should not be modified`);
        }
      }

      // Check also reports mismatch
      const resCheck = runPython(['--check', ws]);
      assert.notEqual(resCheck.status, 0);
      assert.match(resCheck.stderr, /STATUS: MISMATCH/);
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it('refuses mixed partial state on --apply and recovers via --restore', () => {
    const ws = createFixtureWorkspace();
    try {
      // Apply patch to get all patched
      runPython(['--apply', ws]);

      // Manually replace one file with its original (simulating mixed partial state)
      fs.copyFileSync(path.join(FIXTURES_DIR, 'setup-4a_QaRYo.mjs'), path.join(ws, 'setup-4a_QaRYo.mjs'));

      // Check should fail
      const resCheck = runPython(['--check', ws]);
      assert.notEqual(resCheck.status, 0);
      assert.match(resCheck.stderr, /MISMATCH \/ PARTIAL/);

      // Apply should refuse mixed state
      const resApply = runPython(['--apply', ws]);
      assert.notEqual(resApply.status, 0);
      assert.match(resApply.stderr, /mixed partial state/);

      // Restore should successfully recover clean original state from backup
      const resRestore = runPython(['--restore', ws]);
      assert.equal(resRestore.status, 0);
      for (const [fname, origHash] of Object.entries(ORIGINAL_HASHES)) {
        assert.equal(sha256(path.join(ws, fname)), origHash);
      }
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
});

describe('Standalone Logic Verification (Extracted from Patched Artifacts)', () => {
  let ws;

  before(() => {
    ws = createFixtureWorkspace();
    const res = runPython(['--apply', ws]);
    assert.equal(res.status, 0);
  });

  after(() => {
    if (ws) fs.rmSync(ws, { recursive: true, force: true });
  });

  it('exercises mergeBeforeModelResolve with thinkingOverride', () => {
    const content = fs.readFileSync(path.join(ws, 'hook-runner-global-aekT_Vmt.mjs'), 'utf-8');
    const mergeMatch = content.match(/const mergeBeforeModelResolve = \([\s\S]*?\n\t\}\);/);
    assert.ok(mergeMatch, 'mergeBeforeModelResolve definition must exist in patched file');

    const sandbox = {
      firstDefined: (a, b) => a ?? b,
    };
    vm.runInNewContext(mergeMatch[0] + '; merge = mergeBeforeModelResolve;', sandbox);

    // Test 1: Single hook with thinking override
    const r1 = sandbox.merge(undefined, { modelOverride: 'gpt-5', thinkingOverride: 'low' });
    assert.equal(r1.modelOverride, 'gpt-5');
    assert.equal(r1.providerOverride, undefined);
    assert.equal(r1.thinkingOverride, 'low');

    // Test 2: First defined wins for thinkingOverride
    const r2 = sandbox.merge(
      { modelOverride: 'gpt-5', thinkingOverride: 'low' },
      { modelOverride: 'gpt-6', thinkingOverride: 'high' }
    );
    assert.equal(r2.thinkingOverride, 'low', 'First defined thinkingOverride must take precedence');
    assert.equal(r2.modelOverride, 'gpt-5');

    // Test 3: Complementary hooks merge fields
    const r3 = sandbox.merge(
      { modelOverride: 'gpt-5' },
      { providerOverride: 'custom', thinkingOverride: 'max' }
    );
    assert.equal(r3.modelOverride, 'gpt-5');
    assert.equal(r3.providerOverride, 'custom');
    assert.equal(r3.thinkingOverride, 'max');
  });

  it('exercises extracted attempt builder producing flags for opts.model and opts.thinkingOnce', () => {
    const content = fs.readFileSync(path.join(ws, 'attempt-execution-crM9pZWL.mjs'), 'utf-8');
    const match = content.match(/const embeddedRunParams = \{[\s\S]*?\n\t\};/);
    assert.ok(match, 'const embeddedRunParams must exist in patched attempt-execution');

    const code = 'function buildAttempt(params) {\n' + match[0] + '\nreturn embeddedRunParams;\n}';
    const contextObj = new Proxy({
      Boolean,
      params: null,
    }, {
      has: () => true,
      get: (target, prop) => {
        if (prop in target) return target[prop];
        return makeDummyProxy();
      }
    });
    const script = new vm.Script(code);
    const ctx = vm.createContext(contextObj);
    script.runInContext(ctx);

    // Case 1: opts.model and opts.thinkingOnce produce explicit flags
    const r1 = contextObj.buildAttempt({
      opts: { model: 'openai/small-model', thinkingOnce: 'high' },
      resolvedThinkLevel: 'high',
      isFallbackRetry: true,
      runContext: {},
    });
    assert.equal(r1.modelExplicit, true, 'opts.model must produce modelExplicit: true');
    assert.equal(r1.thinkingExplicit, true, 'opts.thinkingOnce must produce thinkingExplicit: true');
    assert.equal(r1.isFallbackRetry, true, 'isFallbackRetry must be carried');
    assert.equal(r1.thinkLevel, 'high');

    // Case 2: opts.provider and opts.thinking produce explicit flags
    const r2 = contextObj.buildAttempt({
      opts: { provider: 'anthropic', thinking: 'medium' },
      resolvedThinkLevel: 'medium',
      isFallbackRetry: false,
      runContext: {},
    });
    assert.equal(r2.modelExplicit, true, 'opts.provider must produce modelExplicit: true');
    assert.equal(r2.thinkingExplicit, true, 'opts.thinking must produce thinkingExplicit: true');
    assert.equal(r2.isFallbackRetry, false);

    // Case 3: normal default produces no override flags
    const r3 = contextObj.buildAttempt({
      opts: {},
      resolvedThinkLevel: 'low',
      runContext: {},
    });
    assert.equal(r3.modelExplicit, false, 'normal default must have modelExplicit: false');
    assert.equal(r3.thinkingExplicit, false, 'normal default must have thinkingExplicit: false');
    assert.equal(r3.isFallbackRetry, undefined, 'normal default has no fallback retry flag');
    assert.equal(r3.thinkLevel, 'low');
  });

  it('exercises extracted resolveHookModelSelection: consumes flags, defends explicit manual, channel manual wins', async () => {
    const content = fs.readFileSync(path.join(ws, 'setup-4a_QaRYo.mjs'), 'utf-8');
    const fnMatch = content.match(/async function resolveHookModelSelection\(params\) \{[\s\S]*?\n\}/);
    assert.ok(fnMatch, 'resolveHookModelSelection definition must exist in patched file');

    const logs = [];
    const sandbox = {
      log: {
        info: (msg) => logs.push({ level: 'info', msg }),
        warn: (msg) => logs.push({ level: 'warn', msg }),
        error: (msg) => logs.push({ level: 'error', msg }),
      },
    };
    vm.runInNewContext(fnMatch[0] + '; run = resolveHookModelSelection;', sandbox);

    // Case 1: Hook event consumes flags
    let capturedEvent = null;
    const mockRunnerCapturing = {
      hasHooks: () => true,
      runBeforeModelResolve: async (ev) => {
        capturedEvent = ev;
        return { modelOverride: 'hook-m', providerOverride: 'hook-p', thinkingOverride: 'medium' };
      }
    };
    await sandbox.run({
      provider: 'init-p',
      modelId: 'init-m',
      prompt: 'task prompt',
      modelExplicit: true,
      thinkingExplicit: true,
      isFallbackRetry: true,
      hookRunner: mockRunnerCapturing,
    });
    assert.ok(capturedEvent, 'before_model_resolve hook must be invoked');
    assert.equal(capturedEvent.routingThinkingSupported, true, 'Must report routingThinkingSupported: true');
    assert.equal(capturedEvent.modelExplicit, true, 'Hook event must consume modelExplicit');
    assert.equal(capturedEvent.thinkingExplicit, true, 'Hook event must consume thinkingExplicit');
    assert.equal(capturedEvent.isFallbackRetry, true, 'Hook event must consume isFallbackRetry');

    // Case 2: Explicit manual wins even if hook returns overrides
    const resManualWins = await sandbox.run({
      provider: 'manual-provider',
      modelId: 'manual-model',
      prompt: 'explicit command run',
      modelExplicit: true,
      thinkingExplicit: true,
      hookRunner: mockRunnerCapturing,
    });
    assert.equal(resManualWins.provider, 'manual-provider', 'Hook providerOverride must not apply when modelExplicit: true');
    assert.equal(resManualWins.modelId, 'manual-model', 'Hook modelOverride must not apply when modelExplicit: true');
    assert.equal(resManualWins.thinkingOverride, undefined, 'Hook thinkingOverride must not apply when thinkingExplicit: true');

    // Case 3: Channel manual think wins (thinkLevelOverride from queued run)
    const resChannelManualThink = await sandbox.run({
      provider: 'channel-provider',
      modelId: 'channel-model',
      prompt: 'channel run',
      thinkLevelOverride: 'high', // channel manual effort
      hookRunner: mockRunnerCapturing,
    });
    assert.equal(resChannelManualThink.thinkingOverride, undefined, 'Channel thinkLevelOverride must suppress hook thinkingOverride');

    // Case 4: Normal default allows hook overrides (no override flags active)
    capturedEvent = null;
    const resNormalDefault = await sandbox.run({
      provider: 'default-provider',
      modelId: 'default-model',
      prompt: 'normal run',
      hookRunner: mockRunnerCapturing,
    });
    assert.equal(capturedEvent.modelExplicit, false, 'No override flags for normal default');
    assert.equal(capturedEvent.thinkingExplicit, false, 'No override flags for normal default');
    assert.equal(capturedEvent.isFallbackRetry, false, 'No override flags for normal default');
    assert.equal(resNormalDefault.provider, 'hook-p', 'Normal default must apply hook providerOverride');
    assert.equal(resNormalDefault.modelId, 'hook-m', 'Normal default must apply hook modelOverride');
    assert.equal(resNormalDefault.thinkingOverride, 'medium', 'Normal default must apply hook thinkingOverride');

    // Case 5: Model selection locked strictly preserves semantic and bypasses hooks
    let lockedHookInvoked = false;
    const mockRunnerLocked = {
      hasHooks: () => true,
      runBeforeModelResolve: async () => { lockedHookInvoked = true; return { modelOverride: 'bad' }; },
    };
    const resLocked = await sandbox.run({
      provider: 'locked-p',
      modelId: 'locked-m',
      prompt: 'locked session',
      modelSelectionLocked: true,
      hookRunner: mockRunnerLocked,
    });
    assert.equal(lockedHookInvoked, false, 'modelSelectionLocked must bypass hooks');
    assert.equal(resLocked.provider, 'locked-p');
    assert.equal(resLocked.modelId, 'locked-m');
  });

  it('exercises extracted agent-runner-utils buildEmbeddedRunBaseParams$1 channel effort transport and model pin snapshot', async () => {
    const content = fs.readFileSync(path.join(ws, 'agent-runner-utils-Bd5FUrZ1.mjs'), 'utf-8');
    const match = content.match(/async function buildEmbeddedRunBaseParams\$1\(params\) \{[\s\S]*?\n\}/);
    assert.ok(match, 'buildEmbeddedRunBaseParams$1 definition must exist in patched file');

    const contextObj = new Proxy({
      Boolean,
      params: null,
    }, {
      has: () => true,
      get: (target, prop) => {
        if (prop in target) return target[prop];
        if (prop === 'then') return undefined;
        return makeDummyProxy();
      }
    });

    const script = new vm.Script(match[0] + '; build = buildEmbeddedRunBaseParams$1;');
    const ctx = vm.createContext(contextObj);
    script.runInContext(ctx);

    // Case 1: Channel manual think transport & fallback retry carry
    const r1 = await contextObj.build({
      run: {
        thinkLevel: 'low',
        thinkLevelOverride: 'max',
      },
      isFallbackRetry: true
    });
    assert.equal(r1.thinkLevel, 'low');
    assert.equal(r1.thinkLevelOverride, 'max', 'builder must transport thinkLevelOverride');
    assert.equal(r1.isFallbackRetry, true, 'builder must carry isFallbackRetry');
    assert.equal(r1.modelExplicit, undefined);

    // Case 2: Session manual model pin snapshot
    const r2 = await contextObj.build({
      run: {
        thinkLevel: 'medium',
        hasSessionModelOverride: true,
        modelOverrideSource: 'user'
      }
    });
    assert.equal(r2.modelExplicit, true, 'builder must snapshot manual model pin into modelExplicit');

    // Case 3: Normal default has no override flags
    const r3 = await contextObj.build({
      run: {
        thinkLevel: 'medium'
      }
    });
    assert.equal(r3.thinkLevelOverride, undefined);
    assert.equal(r3.modelExplicit, undefined);
    assert.equal(r3.isFallbackRetry, undefined);
  });

  it('exercises extracted embedded-agent model setup parameter forwarding and guarded assignment', () => {
    const content = fs.readFileSync(path.join(ws, 'embedded-agent-DNQn_PMM.mjs'), 'utf-8');

    // Verify resolveEmbeddedRunModelSetup forwards parameters into resolveHookModelSelection
    assert.ok(
      content.includes('thinkLevelOverride: runParams.thinkLevelOverride,\n\t\tthinkingExplicit: runParams.thinkingExplicit,\n\t\tmodelExplicit: runParams.modelExplicit,\n\t\tisFallbackRetry: runParams.isFallbackRetry,'),
      'resolveEmbeddedRunModelSetup must carry thinkLevelOverride, thinkingExplicit, modelExplicit, isFallbackRetry'
    );

    // Verify prepareEmbeddedRunRuntime assignment is explicitly guarded without broken routedThinkLevel cross-write
    assert.ok(
      content.includes('if (thinkingOverride && !params.thinkingExplicit && params.thinkLevelOverride === void 0) {\n\t\tparams.thinkLevel = thinkingOverride;\n\t}'),
      'prepareEmbeddedRunRuntime must guard thinkingOverride assignment against thinkingExplicit and thinkLevelOverride'
    );
    assert.ok(
      !content.includes('params.routedThinkLevel = thinkingOverride;'),
      'broken routedThinkLevel propagation must be removed'
    );

    // Test guarded assignment in VM
    const simulateAssignment = (params, thinkingOverride) => {
      const p = { ...params };
      if (thinkingOverride && !p.thinkingExplicit && p.thinkLevelOverride === void 0) {
        p.thinkLevel = thinkingOverride;
      }
      return p;
    };

    // Subcase A: Routed effort applied when no manual overrides
    const sA = simulateAssignment({ thinkLevel: 'low' }, 'high');
    assert.equal(sA.thinkLevel, 'high');

    // Subcase B: Explicit command thinking prevents assignment
    const sB = simulateAssignment({ thinkLevel: 'low', thinkingExplicit: true }, 'high');
    assert.equal(sB.thinkLevel, 'low');

    // Subcase C: Channel manual think prevents assignment
    const sC = simulateAssignment({ thinkLevel: 'low', thinkLevelOverride: 'medium' }, 'high');
    assert.equal(sC.thinkLevel, 'low');
  });
});
