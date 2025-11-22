(() => {
	const outputEl = document.getElementById('output');
	const codeEl = document.getElementById('code');
	const stdinEl = document.getElementById('stdin');
	const btnCompile = document.getElementById('btn-compile');
	const btnRun = document.getElementById('btn-run');
	const btnCompileRun = document.getElementById('btn-compile-run');
	const btnClear = document.getElementById('btn-clear');

	const API_BASE = 'http://localhost:3000';

	let sessionId = null;
	let busy = false;

	function appendOutput(text) {
		outputEl.textContent += text;
		outputEl.scrollTop = outputEl.scrollHeight;
	}

	function setBusy(state) {
		busy = state;
		btnCompile.disabled = state;
		btnRun.disabled = state;
		btnCompileRun.disabled = state;
	}

	async function ensureSession() {
		console.log('ensureSession');
		if (sessionId) return sessionId;
		// Prefer stored session if present
		try {
			const cached = localStorage.getItem('c_ide_session');
			if (cached) sessionId = cached;
		} catch (_) {}
		if (sessionId) return sessionId;
		const res = await fetch(`${API_BASE}/api/session`);
		const json = await res.json();
		sessionId = json.sessionId;
		try {
			localStorage.setItem('c_ide_session', sessionId);
		} catch (_) {}
		return sessionId;
	}

	async function callApi(path, body) {
		const res = await fetch(`${API_BASE}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		});
		return res.json();
	}

	btnCompile.addEventListener('click', async () => {
		if (busy) return;
		setBusy(true);
		try {
			const sid = await ensureSession();
			appendOutput('$ compile\n');
			const resp = await callApi('/api/compile', { sessionId: sid, code: codeEl.value });
			appendOutput((resp.output || '') + '\n');
		} catch (e) {
			appendOutput('Client error during compile.\n');
		} finally {
			setBusy(false);
		}
	});

	btnRun.addEventListener('click', async () => {
		if (busy) return;
		setBusy(true);
		try {
			const sid = await ensureSession();
			appendOutput('$ run\n');
			console.log('run', sid, stdinEl.value);
			const resp = await callApi('/api/run', { sessionId: sid, stdin: stdinEl.value || '' });
			appendOutput((resp.output || '') + '\n');
		} catch (e) {
			appendOutput('Client error during run.\n');
		} finally {
			setBusy(false);
		}
	});

	btnCompileRun.addEventListener('click', async () => {
		if (busy) return;
		setBusy(true);
		try {
			const sid = await ensureSession();
			appendOutput('$ compile && run\n');
			const resp = await callApi('/api/compile-run', {
				sessionId: sid,
				code: codeEl.value,
				stdin: stdinEl.value || '',
			});
			appendOutput((resp.output || '') + '\n');
		} catch (e) {
			appendOutput('Client error during compile & run.\n');
		} finally {
			setBusy(false);
		}
	});

	btnClear.addEventListener('click', () => {
		outputEl.textContent = '';
	});

	// Bootstrap session on load
	ensureSession().catch((error) => {
		console.error('Error ensuring session:', error);
	});
})();


