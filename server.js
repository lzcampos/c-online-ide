const path = require('path');
const fs = require('fs');
const os = require('os');
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');

// Attempt to load node-tinycc if installed (optional)
let tinycc = null;
try {
	// If you install node-tinycc, this may succeed and you can wire it in later
	// eslint-disable-next-line import/no-extraneous-dependencies, global-require
	tinycc = require('node-tinycc');
} catch (e) {
	tinycc = null;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '512kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(cors({ origin: '*' }));
/**
 * Very small in-memory session store.
 * sessionId -> { dir: string, binaryPath?: string, lastCompiledAt?: number }
 */
const sessions = new Map();

function generateSessionId() {
	const rand = Math.random().toString(36).slice(2);
	const ts = Date.now().toString(36);
	return `${ts}-${rand}`;
}

function ensureDir(p) {
	if (!fs.existsSync(p)) {
		fs.mkdirSync(p, { recursive: true });
	}
}

function mkSessionDir(sessionId) {
	const base = path.join(os.tmpdir(), 'c-online-ide');
	ensureDir(base);
	const dir = path.join(base, sessionId);
	ensureDir(dir);
	return dir;
}

function runProcess(command, args, options = {}) {
	return new Promise((resolve) => {
		const child = spawn(command, args, {
			stdio: ['ignore', 'pipe', 'pipe'],
			...options,
		});
		let stdout = '';
		let stderr = '';
		let timedOut = false;

		const killAfterMs = options.killAfterMs ?? 4000;
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				child.kill('SIGKILL');
			} catch (_) {}
		}, killAfterMs);

		child.stdout.on('data', (d) => {
			stdout += d.toString();
		});
		child.stderr.on('data', (d) => {
			stderr += d.toString();
		});
		child.on('close', (code, signal) => {
			clearTimeout(timer);
			resolve({ code, signal, stdout, stderr, timedOut });
		});
	});
}

async function detectCompiler() {
	// Prefer TinyCC (tcc); fallback to gcc
	const tryCmd = async (cmd, args = ['-v']) => {
		try {
			const res = await runProcess(cmd, args, { killAfterMs: 1500 });
			return res.code === 0 || res.code === 1 || res.stdout || res.stderr;
		} catch {
			return false;
		}
	};
	//if (await tryCmd('tcc')) return 'tcc';
	if (await tryCmd('gcc')) return 'gcc';
	return null;
}

async function compileC({ code, outPath, workDir }) {
	// If node-tinycc is available and you want to use it, wire it here.
	// As API varies across versions, default to CLI compilers via spawn.

	const compiler = await detectCompiler();
	if (!compiler) {
		return {
			ok: false,
			stdout: '',
			stderr:
				'No C compiler found. Please install TinyCC (tcc) or GCC and ensure it is on PATH.',
		};
	}

	const sourcePath = path.join(workDir, 'main.c');
	fs.writeFileSync(sourcePath, code, 'utf8');

	const args =
		compiler === 'tcc'
			? [sourcePath, '-o', outPath]
			: [sourcePath, '-w', '-O0', '-o', outPath];

	const { code: exitCode, stdout, stderr, timedOut } = await runProcess(
		compiler,
		args,
		{ cwd: workDir, killAfterMs: 8000 }
	);

	if (timedOut) {
		return { ok: false, stdout, stderr: `${stderr}\nCompilation timed out.`.trim() };
	}
	if (exitCode !== 0) {
		return { ok: false, stdout, stderr };
	}
	return { ok: true, stdout, stderr: '' };
}

async function runBinary({ binPath, workDir, stdinData }) {
	const execPath = binPath;
	const child = spawn(execPath, [], {
		stdio: ['pipe', 'pipe', 'pipe'],
		cwd: workDir,
	});

	let stdout = '';
	let stderr = '';
	let timedOut = false;

	const killAfterMs = 4000;
	const timer = setTimeout(() => {
		timedOut = true;
		try {
			child.kill('SIGKILL');
		} catch (_) {}
	}, killAfterMs);

	if (stdinData && stdinData.length) {
		try {
			child.stdin.write(stdinData);
		} catch (_) {}
	}
	try {
		child.stdin.end();
	} catch (_) {}

	return new Promise((resolve) => {
		child.stdout.on('data', (d) => {
			stdout += d.toString();
		});
		child.stderr.on('data', (d) => {
			stderr += d.toString();
		});
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, stdout, stderr, timedOut });
		});
	});
}

app.get('/api/session', (req, res) => {
	const sessionId = generateSessionId();
	const dir = mkSessionDir(sessionId);
	sessions.set(sessionId, { dir });
	res.json({ sessionId });
});

app.post('/api/compile', async (req, res) => {
	const { code, sessionId } = req.body || {};
	if (!code || typeof code !== 'string') {
		return res.status(400).json({ ok: false, output: 'Missing code' });
	}
	if (!sessionId || !sessions.has(sessionId)) {
		return res.status(400).json({ ok: false, output: 'Invalid sessionId' });
	}
	const session = sessions.get(sessionId);
	const outPath = path.join(session.dir, 'a.out');
	const result = await compileC({ code, outPath, workDir: session.dir });
	if (result.ok) {
		session.binaryPath = outPath;
		session.lastCompiledAt = Date.now();
		return res.json({ ok: true, output: 'Compilation successful.' });
	}
	return res.json({ ok: false, output: `Compilation error:\n${result.stderr || result.stdout}` });
});

app.post('/api/run', async (req, res) => {
	const { sessionId, stdin } = req.body || {};
	if (!sessionId || !sessions.has(sessionId)) {
		return res.status(400).json({ ok: false, output: 'Invalid sessionId' });
	}
	const session = sessions.get(sessionId);
	if (!session.binaryPath || !fs.existsSync(session.binaryPath)) {
		return res
			.status(400)
			.json({ ok: false, output: 'No compiled program found for this session.' });
	}
	const { code, stdout, stderr, timedOut } = await runBinary({
		binPath: session.binaryPath,
		workDir: session.dir,
		stdinData: typeof stdin === 'string' ? stdin : '',
	});
	if (timedOut) {
		return res.json({ ok: false, output: `${stdout}${stderr}\nExecution timed out.`.trim() });
	}
	if (code !== 0 && !stdout && !stderr) {
		return res.json({ ok: false, output: 'Program exited with non-zero status.' });
	}
	return res.json({ ok: true, output: `${stdout}${stderr}` });
});

app.post('/api/compile-run', async (req, res) => {
	const { code, sessionId, stdin } = req.body || {};
	if (!code || typeof code !== 'string') {
		return res.status(400).json({ ok: false, output: 'Missing code' });
	}
	if (!sessionId || !sessions.has(sessionId)) {
		return res.status(400).json({ ok: false, output: 'Invalid sessionId' });
	}
	const session = sessions.get(sessionId);
	const outPath = path.join(session.dir, 'a.out');
	const comp = await compileC({ code, outPath, workDir: session.dir });
	if (!comp.ok) {
		return res.json({ ok: false, output: `Compilation error:\n${comp.stderr || comp.stdout}` });
	}
	session.binaryPath = outPath;
	session.lastCompiledAt = Date.now();

	const exec = await runBinary({
		binPath: outPath,
		workDir: session.dir,
		stdinData: typeof stdin === 'string' ? stdin : '',
	});
	const output = `${exec.stdout || ''}${exec.stderr || ''}`;
	if (exec.timedOut) {
		return res.json({ ok: false, output: `${output}\nExecution timed out.`.trim() });
	}
	return res.json({ ok: true, output });
});

process.on('SIGINT', () => {
	process.exit(0);
});
process.on('exit', () => {
	// Best-effort cleanup of temp directories
	for (const [, s] of sessions.entries()) {
		try {
			if (s.dir && fs.existsSync(s.dir)) {
				fs.rmSync(s.dir, { recursive: true, force: true });
			}
		} catch (_) {}
	}
});

app.listen(PORT, () => {
	// eslint-disable-next-line no-console
	console.log(`Server running at http://localhost:${PORT}`);
});


