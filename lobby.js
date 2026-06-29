// Lightweight lobby script: populate test selector and redirect to game page
async function fetchTestList() {
    try {
        const resp = await fetch('/api/tests');
        if (!resp.ok) return [];
        const payload = await resp.json();
        return Array.isArray(payload.tests) ? payload.tests : [];
    } catch (e) {
        return [];
    }
}

async function initLobby() {
    const testSelect = document.getElementById('test-select');
    const dbCountEl = document.getElementById('db-question-count');
    const sourceEl = document.getElementById('db-source-name');
    const noTestsMsg = document.getElementById('no-tests-message');
    const uploadZone = document.getElementById('pdf-upload-section');
    const readyZone = document.getElementById('database-ready-section');
    const startBtn = document.getElementById('start-game-btn');

    const tests = await fetchTestList();
    if (tests.length) {
        if (testSelect) {
            testSelect.innerHTML = tests.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
            testSelect.disabled = false;
            testSelect.addEventListener('change', () => {
                const sel = testSelect.value;
                if (!sel) return;
                // update banner
                const selTest = tests.find(x => x.id === sel);
                if (dbCountEl) dbCountEl.textContent = `${selTest.name} — ${selTest.count || 0} questions loaded`;
                if (sourceEl) sourceEl.textContent = selTest.name || selTest.source || '';
            });
        }
        if (dbCountEl) dbCountEl.textContent = `${tests[0].name} — ${tests[0].count || 0} questions loaded`;
        if (sourceEl) sourceEl.textContent = tests[0].name || tests[0].source || '';
        if (noTestsMsg) noTestsMsg.style.display = 'none';
        if (startBtn) startBtn.disabled = false;
    } else {
        if (testSelect) {
            testSelect.innerHTML = '<option value="">Stay tuned for updates</option>';
            testSelect.disabled = true;
        }
        if (dbCountEl) dbCountEl.textContent = 'No tests available yet';
        if (sourceEl) sourceEl.textContent = '—';
        if (noTestsMsg) noTestsMsg.style.display = 'block';
        if (startBtn) startBtn.disabled = true;
    }

    // Always hide the parsing/upload spinner on the lobby — show a stable lobby view
    if (uploadZone) uploadZone.style.display = 'none';
    if (readyZone) readyZone.style.display = 'block';

    if (startBtn) {
        startBtn.addEventListener('click', () => {
            const sel = testSelect ? testSelect.value : null;
            if (!sel) return;
            localStorage.setItem('gcp_selected_test', sel);
            window.location.href = 'game.html';
        });
    }

    // Link to question-runner/admin
    const goRunner = document.getElementById('go-to-question-runner-btn');
    if (goRunner) goRunner.addEventListener('click', () => window.location.href = 'question-runner.html');
}

document.addEventListener('DOMContentLoaded', initLobby);
