/* GCP ACE Quiz Quest - Game Logic & PDF Parser Engine */

// Sound Engine using Web Audio API
class SoundEngine {
    constructor() {
        this.ctx = null;
    }
    init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
    }
    playTone(freq, type, duration, gainStart) {
        try {
            this.init();
            if (!this.ctx) return;
            
            // Resume context if suspended (browser security)
            if (this.ctx.state === 'suspended') {
                this.ctx.resume();
            }

            const osc = this.ctx.createOscillator();
            const gainNode = this.ctx.createGain();
            
            osc.type = type || 'sine';
            osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
            
            gainNode.gain.setValueAtTime(gainStart || 0.1, this.ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
            
            osc.connect(gainNode);
            gainNode.connect(this.ctx.destination);
            
            osc.start();
            osc.stop(this.ctx.currentTime + duration);
        } catch (e) {
            console.error('Audio playback failed', e);
        }
    }
    
    playCorrect() {
        // High ascending arpeggio
        setTimeout(() => this.playTone(523.25, 'sine', 0.15, 0.15), 0);    // C5
        setTimeout(() => this.playTone(659.25, 'sine', 0.15, 0.15), 60);    // E5
        setTimeout(() => this.playTone(783.99, 'sine', 0.15, 0.15), 120);   // G5
        setTimeout(() => this.playTone(1046.50, 'sine', 0.3, 0.2), 180);    // C6
    }
    
    playIncorrect() {
        // Buzzy downward slide
        try {
            this.init();
            if (!this.ctx) return;
            if (this.ctx.state === 'suspended') this.ctx.resume();
            
            const osc = this.ctx.createOscillator();
            const gainNode = this.ctx.createGain();
            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(150, this.ctx.currentTime);
            osc.frequency.linearRampToValueAtTime(60, this.ctx.currentTime + 0.4);
            
            gainNode.gain.setValueAtTime(0.15, this.ctx.currentTime);
            gainNode.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.4);
            
            osc.connect(gainNode);
            gainNode.connect(this.ctx.destination);
            osc.start();
            osc.stop(this.ctx.currentTime + 0.4);
        } catch (e) {
            console.error(e);
        }
    }
    
    playTick() {
        this.playTone(800, 'triangle', 0.04, 0.03);
    }
    
    playTimeUp() {
        this.playTone(180, 'square', 0.2, 0.12);
        setTimeout(() => this.playTone(180, 'square', 0.4, 0.12), 80);
    }
    
    playFanfare() {
        const tones = [261.63, 329.63, 392.00, 523.25, 659.25, 783.99, 1046.50];
        tones.forEach((tone, idx) => {
            setTimeout(() => this.playTone(tone, 'triangle', 0.35, 0.12), idx * 80);
        });
    }

    playSparkle() {
        const tones = [1200, 1500, 1800, 2100];
        tones.forEach((tone, idx) => {
            setTimeout(() => this.playTone(tone, 'sine', 0.1, 0.05), idx * 40);
        });
    }
}

// Global States
const sounds = new SoundEngine();
let questionsDb = [];
let currentGame = null;
const referenceImageCache = new Map();

function encodeImagePath(url) {
    return url.split('/').map(part => encodeURIComponent(part)).join('/');
}

async function imageUrlExists(url) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = url;
    });
}

async function resolveReferenceImageUrl(questionId) {
    if (referenceImageCache.has(questionId)) {
        return referenceImageCache.get(questionId);
    }

    const numericId = Number(questionId);
    const extensions = ['png', 'jpg', 'jpeg', 'webp'];
    const candidates = [];

    // Special exception for question 98
    if (numericId === 98) {
        candidates.push('Images/98 Reesponse D');
    }

    candidates.push(`Images/Question #${numericId}`);
    candidates.push(`Images/Question ${numericId}`);
    candidates.push(`Images/Question${numericId}`);
    candidates.push(`Images/Question-${numericId}`);
    candidates.push(`Images/Question_${numericId}`);
    candidates.push(`Images/${numericId}`);

    for (const base of candidates) {
        for (const ext of extensions) {
            const url = `${base}.${ext}`;
            const encodedUrl = encodeImagePath(url);
            if (await imageUrlExists(encodedUrl)) {
                referenceImageCache.set(questionId, encodedUrl);
                return encodedUrl;
            }
        }
    }

    referenceImageCache.set(questionId, null);
    return null;
}

// Virtual Competitors Configuration
const BOTS = [
    { name: 'CloudGuru', accuracy: 0.85, speedMin: 3, speedMax: 12, score: 0 },
    { name: 'K8sMaster', accuracy: 0.78, speedMin: 5, speedMax: 18, score: 0 },
    { name: 'IAMBoss', accuracy: 0.60, speedMin: 8, speedMax: 26, score: 0 },
    { name: 'BigQueryWiz', accuracy: 0.82, speedMin: 10, speedMax: 28, score: 0 }
];

// Helper to Clean OCR artifacts
function cleanOcrText(str) {
    if (!str) return '';
    return str
        .replace(/ג€/g, '"')     // OCR Hebrew smart quotes
        .replace(/ג€œ/g, '"')    // OCR quote open
        .replace(/ג€\?/g, '"')   // OCR quote mark
        .replace(/ג€/g, '"')
        .replace(/`"/g, '"')
        .replace(/“/g, '"')
        .replace(/”/g, '"')
        .replace(/’/g, "'")
        .replace(/‘/g, "'")
        .replace(/`'/g, "'")
        .replace(/\s+/g, ' ')    // Standardize spacing
        .trim();
}

// Helper to identify code blocks (YAML, SQL, CLI commands) and wrap them
function formatQuestionText(text) {
    if (!text) return '';
    
    // We clean standard quotes first
    const cleanedText = cleanOcrText(text);
    
    // Detect potential code blocks by looking for newline structures
    // ExamTopics outputs code blocks often separated by line feeds or specific keywords.
    // Let's check for standard patterns like apiVersion, CREATE TABLE, $ gcloud, etc.
    const codeBlockIndicators = [
        'apiVersion:', 'kind:', 'metadata:', 'spec:', 'containers:', 'image:', 'ports:', 'containerPort:',
        'CREATE TABLE', 'PRIMARY KEY', 'CREATE INDEX', 'SELECT ', 'INSERT INTO', 'INFORMATION_SCHEMA',
        '$ gcloud', 'kubectl get', 'kubectl create', 'gcloud compute', 'gcloud iam'
    ];
    
    // Let's see if we have code runs
    const lines = cleanedText.split(/(?:\r?\n)+|(?:\s{4,})/);
    let htmlOutput = '';
    let inCodeBlock = false;
    let codeLines = [];
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        const isCodeLine = codeBlockIndicators.some(ind => line.includes(ind)) || 
                           (inCodeBlock && (line.includes(':') || line.includes('role') || line.includes('name') || line.includes('value')));
        
        if (isCodeLine) {
            if (!inCodeBlock) {
                inCodeBlock = true;
                codeLines = [];
            }
            codeLines.push(line);
        } else {
            if (inCodeBlock) {
                inCodeBlock = false;
                htmlOutput += `<pre class="code-block">${codeLines.join('\n')}</pre>`;
            }
            htmlOutput += `<p class="question-para">${line}</p>`;
        }
    }
    
    if (inCodeBlock) {
        htmlOutput += `<pre class="code-block">${codeLines.join('\n')}</pre>`;
    }
    
    return htmlOutput || `<p class="question-para">${cleanedText}</p>`;
}

// Categorize questions dynamically by checking keywords
function getQuestionTopic(questionText) {
    const text = questionText.toLowerCase();
    
    if (text.includes('gke') || text.includes('kubernetes') || text.includes('pod') || text.includes('daemonset') || text.includes('statefulset') || text.includes('deployment yaml')) {
        return 'GKE & Containers';
    }
    if (text.includes('compute engine') || text.includes('instance') || text.includes('vm') || text.includes('mig') || text.includes('managed instance group') || text.includes('startup script')) {
        return 'Compute Engine & VMs';
    }
    if (text.includes('vpc') || text.includes('subnet') || text.includes('firewall') || text.includes('vpn') || text.includes('peering') || text.includes('load balancer') || text.includes('route') || text.includes('ip address')) {
        return 'Networking';
    }
    if (text.includes('cloud storage') || text.includes('bucket') || text.includes('lifecycle') || text.includes('nearline') || text.includes('coldline') || text.includes('archive class')) {
        return 'Cloud Storage';
    }
    if (text.includes('iam') || text.includes('role') || text.includes('service account') || text.includes('permission') || text.includes('sso') || text.includes('audit log') || text.includes('active directory')) {
        return 'IAM & Security';
    }
    if (text.includes('bigquery') || text.includes('spanner') || text.includes('cloud sql') || text.includes('bigtable') || text.includes('firestore') || text.includes('database') || text.includes('alloydb')) {
        return 'Databases & Analytics';
    }
    if (text.includes('billing') || text.includes('budget') || text.includes('alert') || text.includes('cost') || text.includes('pricing calculator')) {
        return 'Billing & Resource Management';
    }
    if (text.includes('app engine') || text.includes('cloud run') || text.includes('cloud functions') || text.includes('serverless')) {
        return 'Serverless Compute';
    }
    if (text.includes('stackdriver') || text.includes('logging') || text.includes('monitoring') || text.includes('ops agent') || text.includes('alerting policy')) {
        return 'Operations & Monitoring';
    }
    
    return 'General Cloud Engineering';
}

// PDF Parser function
async function parsePdfContent(arrayBuffer, onProgress) {
    // Load PDF using pdf.js
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const numPages = pdf.numPages;
    let fullText = '';
    
    for (let i = 1; i <= numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        
        let lastY = null;
        let pageText = '';
        
        for (const item of textContent.items) {
            const currentY = item.transform[5];
            
            // Reconstruct layout: if vertical coordinate changes, add a newline
            if (lastY !== null && Math.abs(currentY - lastY) > 8) {
                pageText += '\n';
            }
            pageText += item.str + ' ';
            lastY = currentY;
        }
        
        fullText += `\n\n--- PAGE ${i} ---\n\n` + pageText;
        if (onProgress) onProgress(i, numPages, fullText);
    }
    
    // Parse the full text structurally
    const parts = fullText.split(/Question\s+#/i);
    const parsedQuestions = [];
    
    for (let i = 1; i < parts.length; i++) {
        const part = parts[i].trim();
        if (!part) continue;
        
        try {
            // Get Question ID
            const numMatch = part.match(/^(\d+)/);
            if (!numMatch) continue;
            const qId = parseInt(numMatch[1]);
            
            // Find "Correct Answer:" delimiter
            const ansIndex = part.search(/Correct\s+Answer\s*:/i);
            if (ansIndex === -1) continue;
            
            const bodyAndOptions = part.substring(0, ansIndex).trim();
            const answerAndVotes = part.substring(ansIndex).trim();
            
            // Extract answer letters (e.g. C, BE, etc.)
            let correctAnswer = '';
            const ansMatch = answerAndVotes.match(/Correct\s+Answer\s*:\s*([A-E]+)/i);
            if (ansMatch) {
                correctAnswer = ansMatch[1].trim().toUpperCase();
            } else {
                continue; // Can't play without correct answer
            }
            
            // Extract option content. Options are preceded by whitespace/newlines
            const optARegex = /[\r\n\s]+A\.\s+/;
            const optBRegex = /[\r\n\s]+B\.\s+/;
            const optCRegex = /[\r\n\s]+C\.\s+/;
            const optDRegex = /[\r\n\s]+D\.\s+/;
            const optERegex = /[\r\n\s]+E\.\s+/;
            
            const idxA = bodyAndOptions.search(optARegex);
            const idxB = bodyAndOptions.search(optBRegex);
            const idxC = bodyAndOptions.search(optCRegex);
            const idxD = bodyAndOptions.search(optDRegex);
            const idxE = bodyAndOptions.search(optERegex);
            
            if (idxA === -1 || idxB === -1 || idxC === -1 || idxD === -1) {
                continue; // Skip malformed questions
            }
            
            // Question body is text before option A
            let questionText = bodyAndOptions.substring(0, idxA).trim();
            // Remove Topic metadata line if present
            const lines = questionText.split('\n');
            if (lines.length > 0 && lines[0].toLowerCase().includes('topic')) {
                lines.shift();
            }
            questionText = lines.join('\n').trim();
            
            // Slice option strings
            let optA = '', optB = '', optC = '', optD = '', optE = '';
            optA = bodyAndOptions.substring(idxA, idxB).replace(/^[\r\n\s]*A\.\s+/, '').trim();
            optB = bodyAndOptions.substring(idxB, idxC).replace(/^[\r\n\s]*B\.\s+/, '').trim();
            
            if (idxE !== -1) {
                optC = bodyAndOptions.substring(idxC, idxD).replace(/^[\r\n\s]*C\.\s+/, '').trim();
                optD = bodyAndOptions.substring(idxD, idxE).replace(/^[\r\n\s]*D\.\s+/, '').trim();
                optE = bodyAndOptions.substring(idxE).replace(/^[\r\n\s]*E\.\s+/, '').trim();
            } else {
                optC = bodyAndOptions.substring(idxC, idxD).replace(/^[\r\n\s]*C\.\s+/, '').trim();
                optD = bodyAndOptions.substring(idxD).replace(/^[\r\n\s]*D\.\s+/, '').trim();
            }
            
            // Ingest community vote distribution
            let votes = {};
            const voteIndex = answerAndVotes.search(/Community\s+vote\s+distribution/i);
            if (voteIndex !== -1) {
                const voteStr = answerAndVotes.substring(voteIndex).trim();
                const matches = voteStr.matchAll(/([A-E])\s*\((\d+)%\)/gi);
                for (const match of matches) {
                    votes[match[1].toUpperCase()] = parseInt(match[2]);
                }
            }
            
            // Clean up options
            optA = cleanOcrText(optA);
            optB = cleanOcrText(optB);
            optC = cleanOcrText(optC);
            optD = cleanOcrText(optD);
            if (optE) optE = cleanOcrText(optE);
            
            parsedQuestions.push({
                id: qId,
                question: questionText,
                options: {
                    A: optA,
                    B: optB,
                    C: optC,
                    D: optD,
                    ...(optE ? { E: optE } : {})
                },
                answer: correctAnswer,
                votes: votes
            });
        } catch (e) {
            console.error(`Error parsing index ${i}:`, e);
        }
    }
    
    return parsedQuestions;
}

// Game State Class
class QuizGame {
    constructor(questions, mode, count, timeLimit) {
        this.allQuestions = [...questions];
        this.mode = mode; // 'classic' | 'endless' | 'exam'
        // Normalize timeLimit to a safe number (0 = no timer)
        this.timeLimit = Number(timeLimit);
        if (isNaN(this.timeLimit) || this.timeLimit < 0) this.timeLimit = 0;
        this.maxQuestions = count === 'all' ? this.allQuestions.length : parseInt(count);
        
        // Prepare questions pool
        this.shuffle(this.allQuestions);
        this.questions = this.allQuestions.slice(0, this.maxQuestions);
        
        // Game progression
        this.currentIndex = 0;
        this.score = 0;
        this.accuracyCount = 0;
        this.lifelineUsed = false;
        this.answerProcessed = false; // Track if answer has been processed for current question
        
        // Endless Mode specific
        this.lives = 3;
        
        // Mock Exam specific (doesn't give feedback until end)
        this.answersLog = []; // { qIndex, question, selected, correct, isCorrect }
        
        // Competitors Setup
        this.bots = JSON.parse(JSON.stringify(BOTS)); // Deep clone
        this.leaderboard = [];
        
        // Timer references
        this.timerInterval = null;
        this.timeLeft = this.timeLimit;
        this.timeStart = null;
    }
    
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
    }
    
    getCurrentQuestion() {
        return this.questions[this.currentIndex];
    }
    
    startTimer(onTick, onComplete) {
        if (this.timeLimit === 0) return;
        
        this.timeLeft = this.timeLimit;
        this.timeStart = Date.now();
        
        clearInterval(this.timerInterval);
        this.timerInterval = setInterval(() => {
            this.timeLeft = Math.max(0, this.timeLimit - Math.floor((Date.now() - this.timeStart) / 1000));
            
            // Audio warnings on low time
            if (this.timeLeft <= 5 && this.timeLeft > 0) {
                sounds.playTick();
            }
            
            onTick(this.timeLeft, this.timeLimit);
            
            if (this.timeLeft <= 0) {
                clearInterval(this.timerInterval);
                onComplete();
            }
        }, 100);
    }
    
    stopTimer() {
        clearInterval(this.timerInterval);
        return this.timeStart ? (Date.now() - this.timeStart) / 1000 : 0;
    }
    
    // Simulate bot answers for this question
    simulateBots(currentQuestion) {
        this.bots.forEach(bot => {
            const isCorrect = Math.random() < bot.accuracy;
            bot.lastPoints = 0;
            bot.lastCorrect = isCorrect;
        });
    }
    
    processUserAnswer(selectedOption) {
        if (this.answerProcessed) return null; // Already processed, ignore

        this.answerProcessed = true; // Mark answer as processed

        const q = this.getCurrentQuestion();
        const timeTaken = this.stopTimer();

        // Normalize selected and correct answers to letter arrays
        let selectedLetters = [];
        if (!selectedOption) selectedLetters = [];
        else if (Array.isArray(selectedOption)) selectedLetters = selectedOption.map(s => String(s).toUpperCase());
        else selectedLetters = String(selectedOption).toUpperCase().match(/[A-Z]/g) || [];

        const correctLetters = String(q.answer || '').toUpperCase().match(/[A-Z]/g) || [];

        // Correct only if sets match exactly (order-insensitive)
        const isCorrect = selectedLetters.length > 0 && selectedLetters.length === correctLetters.length &&
            correctLetters.every(c => selectedLetters.includes(c));
        let userPoints = 0;
        
        if (isCorrect) {
            this.accuracyCount++;
        } else {
            if (this.mode === 'endless') {
                this.lives--;
            }
        }
        
        const selectedAnswerText = selectedLetters.length > 0
            ? selectedLetters.map(letter => `${letter}: ${q.options[letter] || 'Unknown'}`).join(', ')
            : 'None (Time Out)';
        const correctAnswerText = correctLetters.length > 0
            ? correctLetters.map(letter => `${letter}: ${q.options[letter] || 'Unknown'}`).join(', ')
            : 'Unknown';
        const questionCategory = getQuestionTopic(q.question);

        // Log answer (for mock exam and final details review)
        this.answersLog.push({
            qIndex: this.currentIndex + 1,
            questionText: q.question,
            selected: selectedOption,
            selectedText: selectedAnswerText,
            correct: q.answer,
            correctText: correctAnswerText,
            isCorrect: isCorrect,
            category: questionCategory
        });
        
        // Simulate bots
        this.simulateBots(q);
        
        // Build leaderboard standing array
        const standings = [
            { name: 'YOU', score: this.score, lastPoints: userPoints, isUser: true, lastCorrect: isCorrect },
            ...this.bots.map(b => ({ name: b.name, score: b.score, lastPoints: b.lastPoints, isUser: false, lastCorrect: b.lastCorrect }))
        ];
        
        // Sort standings descending
        standings.sort((a, b) => b.score - a.score);
        this.leaderboard = standings;
        
        return {
            isCorrect,
            userPoints,
            correctAnswer: q.answer,
            timeLeft: this.timeLeft
        };
    }
    
    nextQuestion() {
        this.currentIndex++;
        this.answerProcessed = false; // Reset for next question
        return this.currentIndex < this.questions.length && (this.mode !== 'endless' || this.lives > 0);
    }
}

// User Interface controller
const UI = {
    // Screens elements
    screens: {
        lobby: document.getElementById('lobby-screen'),
        parse: document.getElementById('parse-screen'),
        history: document.getElementById('history-screen'),
        game: document.getElementById('game-screen'),
        leaderboard: document.getElementById('leaderboard-screen'),
        gameOver: document.getElementById('game-over-screen')
    },
    
    showScreen(screenKey) {
        Object.keys(this.screens).forEach(key => {
            this.screens[key].classList.toggle('active', key === screenKey);
        });
        
        // Ambient background morphs slowly based on screen
        const glow1 = document.querySelector('.glow-1');
        const glow2 = document.querySelector('.glow-2');
        if (screenKey === 'game') {
            glow1.style.background = 'radial-gradient(circle, var(--option-red) 0%, rgba(0,0,0,0) 70%)';
            glow2.style.background = 'radial-gradient(circle, var(--option-green) 0%, rgba(0,0,0,0) 70%)';
        } else if (screenKey === 'gameOver') {
            glow1.style.background = 'radial-gradient(circle, var(--warning) 0%, rgba(0,0,0,0) 70%)';
            glow2.style.background = 'radial-gradient(circle, var(--accent) 0%, rgba(0,0,0,0) 70%)';
            sounds.playFanfare();
        } else {
            glow1.style.background = 'radial-gradient(circle, var(--accent) 0%, rgba(0,0,0,0) 70%)';
            glow2.style.background = 'radial-gradient(circle, var(--option-blue) 0%, rgba(0,0,0,0) 70%)';
        }
    },
    
    // Updates global statistics shown in header
    updateHeaderStats() {
        const stats = JSON.parse(localStorage.getItem('gcp_quiz_stats')) || { totalQuestions: 0, correctQuestions: 0, totalGames: 0 };
        const accuracyDisplay = document.getElementById('accuracy-display');
        const headerStats = document.getElementById('header-stats');
        
        if ((stats.totalQuestions || 0) > 0) {
            headerStats.style.display = 'flex';
            const acc = Math.round((stats.correctQuestions / stats.totalQuestions) * 100);
            accuracyDisplay.textContent = `Accuracy: ${acc}%`;
            
            // Lobby stats
            document.getElementById('stats-dashboard').style.display = 'block';
            document.getElementById('stats-total-played').textContent = stats.totalGames || 0;
            document.getElementById('stats-total-questions').textContent = stats.totalQuestions;
            document.getElementById('stats-avg-accuracy').textContent = `${acc}%`;
        } else {
            headerStats.style.display = 'none';
            document.getElementById('stats-dashboard').style.display = 'none';
        }
    },
    
    getHistory() {
        try {
            return JSON.parse(localStorage.getItem('gcp_quiz_history')) || [];
        } catch (e) {
            return [];
        }
    },

    saveHistoryEntry(entry) {
        const history = this.getHistory();
        history.unshift(entry);
        if (history.length > 50) history.splice(50);
        localStorage.setItem('gcp_quiz_history', JSON.stringify(history));
    },

    clearHistory() {
        localStorage.removeItem('gcp_quiz_history');
        this.renderHistory();
    },

    renderHistory() {
        const history = this.getHistory();
        const list = document.getElementById('history-list');
        const summary = document.getElementById('history-summary-text');
        if (!list || !summary) return;

        if (!history.length) {
            summary.textContent = 'No history recorded yet. Complete a quiz to start tracking your progress.';
            list.innerHTML = '';
            return;
        }

        summary.textContent = `Showing ${history.length} most recent sessions.`;
        list.innerHTML = history.map(entry => {
            const topics = Object.entries(entry.topicBreakdown || {})
                .map(([topic, count]) => `${topic}: ${count}`)
                .join(', ') || 'No topic issues';
            return `
                <div class="history-entry">
                    <div class="history-entry-top">
                        <div><strong>${entry.date}</strong> · ${entry.mode.toUpperCase()}</div>
                        <div class="history-entry-score">${entry.accuracy}%</div>
                    </div>
                    <div class="history-entry-meta">
                        Answered: ${entry.totalAnswered} · Correct: ${entry.correctCount} · Mistakes: ${entry.mistakesCount}
                    </div>
                    <div class="history-entry-topics">${topics}</div>
                </div>
            `;
        }).join('');
    },

    exportHistoryPdf() {
        const history = this.getHistory();
        if (!history.length) {
            alert('No history to export yet. Complete a quiz first.');
            return;
        }

        const { jsPDF } = window.jspdf || {};
        if (!jsPDF) {
            alert('PDF export library is not loaded.');
            return;
        }

        const doc = new jsPDF({ unit: 'pt', format: 'letter' });
        const margin = 40;
        let y = 40;
        doc.setFontSize(16);
        doc.text('GCP Quest Progress History', margin, y);
        y += 28;
        doc.setFontSize(11);

        history.forEach((entry, index) => {
            if (y > 740) {
                doc.addPage();
                y = 40;
            }
            doc.setFont(undefined, 'bold');
            doc.text(`${entry.date} — ${entry.mode.toUpperCase()} — ${entry.accuracy}%`, margin, y);
            y += 16;
            doc.setFont(undefined, 'normal');
            doc.text(`Answered: ${entry.totalAnswered}, Correct: ${entry.correctCount}, Mistakes: ${entry.mistakesCount}`, margin, y);
            y += 14;
            const topics = Object.entries(entry.topicBreakdown || {})
                .map(([topic, count]) => `${topic}: ${count}`)
                .join(', ');
            doc.text(`Improvement topics: ${topics || 'None'}`, margin, y);
            y += 20;
        });

        doc.save('GCP_Quest_History.pdf');
    },

    // Save current game accuracy stats to the database
    saveStats(correctCount, totalCount) {
        const stats = JSON.parse(localStorage.getItem('gcp_quiz_stats')) || { bestAccuracy: 0, totalGames: 0, totalQuestions: 0, correctQuestions: 0 };

        const cc = Number(correctCount) || 0;
        const tc = Number(totalCount) || 0;

        stats.totalGames = (stats.totalGames || 0) + 1;
        stats.totalQuestions = (stats.totalQuestions || 0) + tc;
        stats.correctQuestions = (stats.correctQuestions || 0) + cc;

        const currentAccuracy = tc > 0 ? Math.round((cc / tc) * 100) : 0;
        const safeCurrentAccuracy = Math.max(0, Math.min(100, currentAccuracy));

        const prevBest = Number(stats.bestAccuracy) || 0;
        if (safeCurrentAccuracy > prevBest) {
            stats.bestAccuracy = safeCurrentAccuracy;
        }

        localStorage.setItem('gcp_quiz_stats', JSON.stringify(stats));
        this.updateHeaderStats();
    },

    saveHistoryEntryFromGame(currentGame, totalAnswered, accPct, mistakes, topicBreakdown) {
        const entry = {
            id: Date.now(),
            date: new Date().toLocaleString(),
            mode: currentGame.mode,
            totalAnswered,
            correctCount: currentGame.accuracyCount,
            accuracy: accPct,
            mistakesCount: mistakes.length,
            topicBreakdown,
            mistakes: mistakes.map(m => ({ qIndex: m.qIndex, category: m.category, selectedText: m.selectedText, correctText: m.correctText }))
        };
        this.saveHistoryEntry(entry);
    },

    // Initialize or auto-load the default bundled PDF
    async autoLoadDefaultPdf() {
        const uploadZone = document.getElementById('pdf-upload-section');
        const readyZone  = document.getElementById('database-ready-section');

        // 1. If questions are already cached in localStorage, use them instantly
        const cached = localStorage.getItem('gcp_questions_db');
        if (cached) {
            questionsDb = JSON.parse(cached);
            uploadZone.style.display = 'none';
            readyZone.style.display  = 'block';
            document.getElementById('db-question-count').textContent =
                `Database Ready: ${questionsDb.length} Questions Loaded`;
            document.getElementById('db-source-name').textContent =
                localStorage.getItem('gcp_db_source') || 'kahoot.pdf';
            return;
        }

        // 2. Otherwise fetch the bundled PDF and parse it
        uploadZone.style.display = 'flex';  // show the spinner
        readyZone.style.display  = 'none';

        try {
            const response = await fetch('./kahoot.pdf');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const arrayBuffer = await response.arrayBuffer();

            // Show the full parse screen so the user sees progress
            UI.showScreen('parse');
            const fill        = document.getElementById('parse-progress-fill');
            const pageStatus  = document.getElementById('parse-page-status');
            const countStatus = document.getElementById('parse-count-status');

            const questions = await parsePdfContent(
                arrayBuffer,
                (page, total, currentText) => {
                    const pct = Math.round((page / total) * 100);
                    fill.style.width   = `${pct}%`;
                    pageStatus.textContent  = `Processing Page ${page}/${total}...`;
                    const matches = currentText.match(/Question\s+#/gi);
                    countStatus.textContent = `${matches ? matches.length : 0} Questions extracted`;
                }
            );

            if (questions.length === 0) {
                alert('Could not extract questions from the default PDF. Please load a different PDF.');
                UI.showScreen('lobby');
                uploadZone.style.display = 'flex';
                return;
            }

            localStorage.setItem('gcp_questions_db', JSON.stringify(questions));
            localStorage.setItem('gcp_db_source', 'kahoot.pdf');
            questionsDb = questions;

            uploadZone.style.display = 'none';
            readyZone.style.display  = 'block';
            document.getElementById('db-question-count').textContent =
                `Database Ready: ${questions.length} Questions Loaded`;
            document.getElementById('db-source-name').textContent = 'kahoot.pdf';

            UI.showScreen('lobby');
        } catch (err) {
            console.error('Could not auto-load default PDF:', err);
            // Error: kahoot.pdf not found or unreadable
            uploadZone.className = 'upload-zone error-zone';
            uploadZone.innerHTML = `
                <i class="fa-solid fa-circle-exclamation error-icon"></i>
                <h3>Error Loading Question Database</h3>
                <p>The kahoot.pdf file could not be found or loaded.</p>
                <p style="font-size: 0.9rem; color: var(--text-secondary);">Please ensure kahoot.pdf is in the application directory.</p>
            `;
            readyZone.style.display = 'none';
            UI.showScreen('lobby');
        }
    },
    
    // Show current question in interface
    renderQuestion() {
        const q = currentGame.getCurrentQuestion();
        const indexText = document.getElementById('game-q-index');
        const timerSec = document.getElementById('timer-sec');
        const qIdBadge = document.getElementById('question-id-badge');
        const textContent = document.getElementById('question-text-content');
        const grid = document.getElementById('answers-grid');
        const lifelineBtn = document.getElementById('lifeline-btn');
        const nextBtn = document.getElementById('next-question-btn');
        const imageBtn = document.getElementById('image-reference-btn');
        if (nextBtn) nextBtn.disabled = true;
        if (imageBtn) {
            imageBtn.style.display = 'none';
            imageBtn.disabled = true;
            imageBtn.removeAttribute('data-image-url');
        }
        
        // Reset status popup before showing a new question
        const feedbackOverlay = document.getElementById('feedback-overlay');
        feedbackOverlay.className = 'feedback-overlay';
        document.getElementById('feedback-icon').className = 'fa-solid';
        document.getElementById('feedback-message').textContent = '';
        document.getElementById('correct-answer-letter').textContent = '';
        const voteChartContainer = document.getElementById('hint-vote-chart-container');
        voteChartContainer.style.display = 'none';
        document.getElementById('vote-bars-list').innerHTML = '';
        
        // Setup stats & progression label
        if (currentGame.mode === 'endless') {
            indexText.textContent = `Lives: ${'❤️'.repeat(currentGame.lives)}`;
        } else {
            indexText.textContent = `${currentGame.currentIndex + 1}/${currentGame.questions.length}`;
        }
        
        document.getElementById('game-score-val').textContent = currentGame.accuracyCount.toString();
        qIdBadge.textContent = `Q#${q.id}`;
        
        // Format question body text (handle paragraphs, code snippets)
        textContent.innerHTML = formatQuestionText(q.question);
        
        // Render answers card grid dynamically
        grid.innerHTML = '';
        const shapes = ['triangle', 'diamond', 'circle', 'square', 'circle']; // fallback shape
        const colorClasses = ['option-a', 'option-b', 'option-c', 'option-d', 'option-a'];
        
        // Detect multiple-response prompts like "choose two", "select two", "choose 3"
        q.isMultiple = false;
        q.requiredSelections = 1;
        try {
            const txt = (q.question || '').toLowerCase();
            const chooseMatch = txt.match(/\b(?:choose|select)\s+(one|two|three|four|five|both|\d+)\b/);
            const allApplyMatch = /select all that apply/.test(txt) || /choose all that apply/.test(txt);

            if (chooseMatch) {
                const map = { one:1, two:2, three:3, four:4, five:5, both:2 };
                const val = chooseMatch[1];
                q.requiredSelections = map[val] || parseInt(val) || 1;
                q.isMultiple = q.requiredSelections > 1;
            } else if (allApplyMatch) {
                q.isMultiple = true;
                q.requiredSelections = Object.keys(q.options).length;
            }
        } catch (e) { /* ignore parsing errors */ }

        const letters = Object.keys(q.options).sort(); // A, B, C, D, E
        q.requiredSelections = Math.max(1, Math.min(q.requiredSelections, letters.length));
        const multiSelections = new Set();

        letters.forEach((letter, i) => {
            const btn = document.createElement('button');
            btn.className = `answer-card ${colorClasses[i]}`;
            btn.dataset.option = letter;

            const shapeDiv = document.createElement('div');
            shapeDiv.className = `shape ${shapes[i]}`;

            const letterSpan = document.createElement('span');
            letterSpan.className = 'option-letter';
            letterSpan.textContent = letter;

            const textSpan = document.createElement('span');
            textSpan.className = 'option-text';
            textSpan.textContent = q.options[letter];

            btn.appendChild(shapeDiv);
            btn.appendChild(letterSpan);
            btn.appendChild(textSpan);

            // Add click listener
            if (q.isMultiple) {
                btn.addEventListener('click', () => {
                    // Toggle selection
                    if (multiSelections.has(letter)) {
                        multiSelections.delete(letter);
                        btn.classList.remove('multi-selected');
                    } else {
                        // Prevent selecting more than required
                        if (multiSelections.size >= q.requiredSelections) return;
                        multiSelections.add(letter);
                        btn.classList.add('multi-selected');
                    }

                    // Enable Next only when we've selected the required number
                    if (nextBtn) nextBtn.disabled = (multiSelections.size !== q.requiredSelections);
                });
            } else {
                btn.addEventListener('click', () => this.handleAnswerSelect(letter));
            }

            grid.appendChild(btn);
        });
        
        // Adjust grid layout based on option count (e.g. support 5 options gracefully)
        if (letters.length > 4) {
            grid.style.gridTemplateColumns = '1fr';
        } else {
            grid.style.gridTemplateColumns = window.innerWidth <= 768 ? '1fr' : '1fr 1fr';
        }
        
        // Check Lifeline availability
        lifelineBtn.style.display = (currentGame.mode === 'exam') ? 'none' : 'block';
        lifelineBtn.disabled = currentGame.lifelineUsed;
        lifelineBtn.innerHTML = `<i class="fa-solid fa-users"></i> Ask Community ${currentGame.lifelineUsed ? '(Used)' : '(1)'}`;
        
        // Show image reference button if image exists
        if (imageBtn) {
            resolveReferenceImageUrl(q.id).then(url => {
                if (!url) return;
                imageBtn.dataset.imageUrl = url;
                imageBtn.style.display = 'inline-flex';
                imageBtn.disabled = false;
                imageBtn.onclick = () => this.openReferenceImagePopup(url, q.id);
            });
        }

        // Trigger timer
        if (currentGame.timeLimit > 0) {
            timerSec.textContent = currentGame.timeLimit;
            document.getElementById('timer-progress').style.strokeDasharray = '100, 100';
            currentGame.startTimer(
                (timeLeft, timeLimit) => {
                    timerSec.textContent = timeLeft;
                    const pct = (timeLeft / timeLimit) * 100;
                    document.getElementById('timer-progress').style.strokeDasharray = `${pct}, 100`;
                    
                    // Adjust color gradient of circular timer based on time left
                    const path = document.getElementById('timer-progress');
                    if (timeLeft <= 5) {
                        path.style.stroke = 'var(--error)';
                    } else if (timeLeft <= 12) {
                        path.style.stroke = 'var(--warning)';
                    } else {
                        path.style.stroke = 'var(--accent)';
                    }
                },
                () => {
                    this.handleTimeUp();
                }
            );
        } else {
            timerSec.textContent = '∞';
            document.getElementById('timer-progress').style.strokeDasharray = '100, 100';
            document.getElementById('timer-progress').style.stroke = 'var(--accent)';
        }
    },

    openReferenceImagePopup(imageUrl, questionId) {
        const overlay = document.getElementById('image-popup-overlay');
        const preview = document.getElementById('question-image-preview');
        const title = document.getElementById('image-popup-question-id');
        if (!overlay || !preview || !title) return;
        preview.src = imageUrl;
        preview.alt = `Reference image for question ${questionId}`;
        title.textContent = `Q#${questionId}`;
        overlay.style.display = 'flex';
        requestAnimationFrame(() => overlay.classList.add('active'));
    },

    closeReferenceImagePopup() {
        const overlay = document.getElementById('image-popup-overlay');
        if (!overlay) return;
        overlay.classList.remove('active');
        setTimeout(() => {
            overlay.style.display = 'none';
            const preview = document.getElementById('question-image-preview');
            if (preview) preview.src = '';
        }, 220);
    },
    
    // User clicks an option
    handleAnswerSelect(selectedOption) {
        if (currentGame.timeLimit > 0) {
            clearInterval(currentGame.timerInterval);
        }
        
        // Disable option buttons
        const buttons = document.querySelectorAll('.answer-card');
        buttons.forEach(btn => btn.disabled = true);
        
        const result = currentGame.processUserAnswer(selectedOption);
        
        // Audio cues & highlighting
        if (currentGame.mode === 'exam') {
            // Mock Exam mode: reveal correct/incorrect similar to other modes,
            // but do not show the full leaderboard screen — allow user to proceed.
            if (result.isCorrect) {
                sounds.playCorrect();
                document.getElementById('feedback-overlay').className = 'feedback-overlay active correct';
                document.getElementById('feedback-icon').className = 'fa-solid fa-circle-check';
                document.getElementById('feedback-message').textContent = 'Correct!';
            } else {
                sounds.playIncorrect();
                document.getElementById('feedback-overlay').className = 'feedback-overlay active incorrect';
                document.getElementById('feedback-icon').className = 'fa-solid fa-circle-xmark';
                document.getElementById('feedback-message').textContent = 'Incorrect!';
            }

            // Highlight options: correct in green, user's wrong selections in red
            buttons.forEach(btn => {
                const opt = btn.dataset.option;
                if (result.correctAnswer.includes(opt)) {
                    btn.classList.add('correct-answer-highlight');
                } else if (String(selectedOption).toUpperCase().includes(opt)) {
                    btn.classList.add('wrong-answer-highlight');
                } else {
                    btn.classList.add('fade-out');
                }
            });

            document.getElementById('correct-answer-letter').textContent = result.correctAnswer;

            // Enable Next button so the user can continue at their own pace
            const nextBtnExam = document.getElementById('next-question-btn');
            if (nextBtnExam) nextBtnExam.disabled = false;
        } else {
            // Standard/Endless modes: reveal correctness instantly
            if (result.isCorrect) {
                sounds.playCorrect();
                document.getElementById('feedback-overlay').className = 'feedback-overlay active correct';
                document.getElementById('feedback-icon').className = 'fa-solid fa-circle-check';
                document.getElementById('feedback-message').textContent = 'Correct!';
            } else {
                sounds.playIncorrect();
                document.getElementById('feedback-overlay').className = 'feedback-overlay active incorrect';
                document.getElementById('feedback-icon').className = 'fa-solid fa-circle-xmark';
                document.getElementById('feedback-message').textContent = 'Incorrect!';
            }
            
            // Highlight options
            buttons.forEach(btn => {
                const opt = btn.dataset.option;
                if (result.correctAnswer.includes(opt)) {
                    btn.classList.add('correct-answer-highlight');
                } else if (String(selectedOption).toUpperCase().includes(opt)) {
                    btn.classList.add('wrong-answer-highlight');
                } else {
                    btn.classList.add('fade-out');
                }
            });
            
            document.getElementById('correct-answer-letter').textContent = result.correctAnswer;
            
            // Hide Lifeline display chart on overlay unless it was triggered
            document.getElementById('hint-vote-chart-container').style.display = 'none';
            // Enable "Next" only after an answer was processed
            const nextBtn = document.getElementById('next-question-btn');
            if (nextBtn) nextBtn.disabled = false;
        }
    },
    
    // Timer fires 0
    handleTimeUp() {
        const buttons = document.querySelectorAll('.answer-card');
        buttons.forEach(btn => btn.disabled = true);
        
        sounds.playTimeUp();
        
        const result = currentGame.processUserAnswer(''); // no option selected
        
        if (currentGame.mode === 'exam') {
            setTimeout(() => this.advanceGame(), 1200);
        } else {
            document.getElementById('feedback-overlay').className = 'feedback-overlay active time-up';
            document.getElementById('feedback-icon').className = 'fa-solid fa-hourglass-end';
            document.getElementById('feedback-message').textContent = "Time's Up!";
            document.getElementById('correct-answer-letter').textContent = result.correctAnswer;
            
            buttons.forEach(btn => {
                const opt = btn.dataset.option;
                if (result.correctAnswer.includes(opt)) {
                    btn.classList.add('correct-answer-highlight');
                } else {
                    btn.classList.add('fade-out');
                }
            });
            
            // While showing the correct answer for 4 seconds, disable "Next" so users cannot skip early
            const nextBtn = document.getElementById('next-question-btn');
            if (nextBtn) nextBtn.disabled = true;

            // Show correct answer for 4 seconds then advance
            setTimeout(() => this.advanceGame(), 4000);
        }
    },
    
    // Lifeline "Ask the Community" click
    triggerLifeline() {
        if (currentGame.lifelineUsed) return;
        currentGame.lifelineUsed = true;
        sounds.playSparkle();
        
        document.getElementById('lifeline-btn').disabled = true;
        
        const q = currentGame.getCurrentQuestion();
        const container = document.getElementById('hint-vote-chart-container');
        const list = document.getElementById('vote-bars-list');
        list.innerHTML = '';
        
        // Show chart container
        container.style.display = 'block';
        
        // Prepare vote stats. If no stats in PDF, simulate mock statistics biased towards correct answer
        let votes = q.votes && Object.keys(q.votes).length > 0 ? q.votes : {};
        if (Object.keys(votes).length === 0) {
            const letters = Object.keys(q.options);
            let remaining = 100;
            // Bias correct option
            letters.forEach(letter => {
                if (q.answer.includes(letter)) {
                    votes[letter] = Math.round(50 + Math.random() * 25);
                } else {
                    votes[letter] = 0;
                }
                remaining -= votes[letter];
            });
            // Distribute remaining
            const incorrects = letters.filter(l => !q.answer.includes(l));
            incorrects.forEach((l, idx) => {
                if (idx === incorrects.length - 1) {
                    votes[l] = remaining;
                } else {
                    votes[l] = Math.round(Math.random() * remaining);
                    remaining -= votes[l];
                }
            });
        }
        
        // Render vote bars
        Object.keys(q.options).sort().forEach(letter => {
            const pct = votes[letter] || 0;
            const isCorrect = q.answer.includes(letter);
            
            const item = document.createElement('div');
            item.className = 'vote-item';
            
            const barTrack = document.createElement('div');
            barTrack.className = 'vote-bar-track';
            
            const barFill = document.createElement('div');
            barFill.className = `vote-bar-fill ${isCorrect ? 'correct' : ''}`;
            barFill.style.height = '0%'; // Start at 0 for slide animation
            
            const label = document.createElement('span');
            label.className = 'vote-item-label';
            label.textContent = letter;
            
            const pctSpan = document.createElement('span');
            pctSpan.className = 'vote-percent';
            pctSpan.textContent = `${pct}%`;
            
            barTrack.appendChild(barFill);
            item.appendChild(pctSpan);
            item.appendChild(barTrack);
            item.appendChild(label);
            list.appendChild(item);
            
            // Trigger animation in next frame
            setTimeout(() => {
                barFill.style.height = `${pct}%`;
            }, 50);
        });
        
        // Slide open the feedback overlay briefly as a panel to see the stats
        document.getElementById('feedback-overlay').className = 'feedback-overlay active time-up';
        document.getElementById('feedback-icon').className = 'fa-solid fa-chart-column';
        document.getElementById('feedback-message').textContent = 'Community Hint';
        // Do not allow advancing when only viewing community hint (no answer processed)
        const nextBtn = document.getElementById('next-question-btn');
        if (nextBtn) nextBtn.disabled = true;
    },
    
    // Advances to leaderboard standings or game over screen
    advanceGame() {
        const hasNext = currentGame.nextQuestion();
        if (hasNext) {
            this.showScreen('game');
            this.renderQuestion();
        } else {
            this.endGame();
        }
    },
    
    // Show intermediate leaderboard standings
    renderLeaderboard() {
        this.showScreen('leaderboard');
        
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = '';
        
        currentGame.leaderboard.forEach((player, i) => {
            const row = document.createElement('div');
            row.className = `leaderboard-row ${player.isUser ? 'player-user' : ''}`;
            
            const rankName = document.createElement('div');
            rankName.className = 'rank-name';
            
            const rankNum = document.createElement('span');
            rankNum.className = 'rank-num';
            rankNum.textContent = i + 1;
            
            const name = document.createElement('span');
            name.className = 'player-name';
            name.textContent = player.name;
            
            rankName.appendChild(rankNum);
            rankName.appendChild(name);
            
            const scoreStat = document.createElement('div');
            scoreStat.className = 'score-stat';
            
            const val = document.createElement('span');
            val.className = 'score-val';
            val.textContent = player.score.toLocaleString();
            
            const change = document.createElement('span');
            change.className = 'score-change';
            
            if (player.lastPoints > 0) {
                change.textContent = `+${player.lastPoints.toLocaleString()}`;
                change.style.color = 'var(--success)';
            } else if (player.lastCorrect === false && player.isUser) {
                change.textContent = 'Wrong';
                change.style.color = 'var(--error)';
            } else {
                change.textContent = '';
            }
            
            scoreStat.appendChild(val);
            scoreStat.appendChild(change);
            row.appendChild(rankName);
            row.appendChild(scoreStat);
            list.appendChild(row);
        });
    },
    
    // Game over screen setup
    endGame() {
        this.showScreen('gameOver');
        
        // Save statistics
        this.saveStats(currentGame.accuracyCount, currentGame.currentIndex);
        
        // Setup final result values
        const totalAnswered = currentGame.currentIndex;
        const accPct = totalAnswered > 0 ? Math.round((currentGame.accuracyCount / totalAnswered) * 100) : 0;
        document.getElementById('result-answered').textContent = totalAnswered.toString();
        document.getElementById('result-accuracy').textContent = `${accPct}%`;
        
        // Build mistakes review section if any incorrect answers exist
        const mistakes = currentGame.answersLog.filter(a => !a.isCorrect);
        const reviewContainer = document.getElementById('mistakes-review-container');
        const reviewList = document.getElementById('mistakes-review-list');

        // Compute topic breakdown to derive top improvement category
        let topicBreakdown = {};
        mistakes.forEach(m => {
            topicBreakdown[m.category] = (topicBreakdown[m.category] || 0) + 1;
        });

        const topCategory = Object.keys(topicBreakdown).length ?
            Object.entries(topicBreakdown).sort((a,b) => b[1] - a[1])[0][0] : '—';

        // Build improvement summary lines (each category on its own line)
        const improvementLines = Object.entries(topicBreakdown).length ?
            Object.entries(topicBreakdown)
                .sort((a,b) => b[1] - a[1])
                .map(([topic, count]) => `${topic} — ${count} ${count === 1 ? 'mistake' : 'mistakes'}`) : [];

        const resultCatEl = document.getElementById('result-category');
        if (resultCatEl) {
            if (improvementLines.length) {
                resultCatEl.innerHTML = improvementLines.join('<br>');
            } else {
                resultCatEl.textContent = '—';
            }
        }

        this.saveHistoryEntryFromGame(currentGame, totalAnswered, accPct, mistakes, topicBreakdown);

        if (mistakes.length > 0) {
            reviewContainer.style.display = 'block';
            reviewList.innerHTML = '';

            mistakes.forEach(m => {
                const item = document.createElement('div');
                item.className = 'mistake-item';

                const title = document.createElement('div');
                title.className = 'mistake-q-title';
                title.innerHTML = `Q${m.qIndex}: ${m.questionText.substring(0, 140)}...`;

                const answerSummary = document.createElement('div');
                answerSummary.className = 'mistake-q-ans';
                answerSummary.innerHTML = `Your Answer: <span style="color: var(--error)">${m.selectedText}</span><br>Correct Answer: <strong>${m.correctText}</strong><br>Category: <strong>${m.category}</strong>`;

                item.appendChild(title);
                item.appendChild(answerSummary);
                reviewList.appendChild(item);
            });

            // No separate top-category block anymore; results grid shows the improvement summary text.

            if (currentGame.mode === 'exam') {
                const analysisHeader = document.createElement('div');
                analysisHeader.className = 'topic-analysis-banner';
                analysisHeader.innerHTML = `
                    <h4>Weakest Practice Domains:</h4>
                    <ul>
                        ${Object.entries(topicBreakdown)
                            .sort((a,b) => b[1] - a[1])
                            .slice(0, 3)
                            .map(([topic, count]) => `<li><strong>${topic}</strong> (${count} mistakes)</li>`)
                            .join('')}
                    </ul>
                `;
                reviewList.insertBefore(analysisHeader, reviewList.firstChild);
            }
        } else {
            reviewContainer.style.display = 'none';
            // ensure nothing attempts to reference the removed top-category element
        }
    }
};

// Application Event Listeners & Bootstrapping
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize statistics header
    UI.updateHeaderStats();

    // 2. Auto-load the bundled default PDF (or use localStorage cache)
    await UI.autoLoadDefaultPdf();

    // ── Shared PDF parse helper (used by auto-load fallback & manual upload) ──
    async function handlePdfFile(file) {
        UI.showScreen('parse');
        const fill        = document.getElementById('parse-progress-fill');
        const pageStatus  = document.getElementById('parse-page-status');
        const countStatus = document.getElementById('parse-count-status');

        try {
            const arrayBuffer = await file.arrayBuffer();
            const questions   = await parsePdfContent(arrayBuffer, (page, total, currentText) => {
                const pct = Math.round((page / total) * 100);
                fill.style.width        = `${pct}%`;
                pageStatus.textContent  = `Processing Page ${page}/${total}...`;
                const matches = currentText.match(/Question\s+#/gi);
                countStatus.textContent = `${matches ? matches.length : 0} Questions extracted`;
            });

            if (questions.length === 0) {
                alert('No questions could be extracted. Please check the PDF format.');
                UI.showScreen('lobby');
                return;
            }

            localStorage.setItem('gcp_questions_db', JSON.stringify(questions));
            localStorage.setItem('gcp_db_source', file.name);
            questionsDb = questions;

            // Refresh the db-ready section
            const uploadZone = document.getElementById('pdf-upload-section');
            const readyZone  = document.getElementById('database-ready-section');
            uploadZone.style.display = 'none';
            readyZone.style.display  = 'block';
            document.getElementById('db-question-count').textContent =
                `Database Ready: ${questions.length} Questions Loaded`;
            document.getElementById('db-source-name').textContent = file.name;

            UI.showScreen('lobby');
        } catch (err) {
            console.error('PDF parsing error', err);
            alert('Failed to read PDF file: ' + err.message);
            UI.showScreen('lobby');
        }
    }


    
    // 4. Game Config Mode buttons selection
    const modeBtns = document.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            modeBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Hide question count selector if Mock Exam or Endless selected
            const countGroup = document.getElementById('question-count-group');
            const mode = btn.dataset.mode;
            if (mode === 'exam' || mode === 'endless') {
                countGroup.style.opacity = '0.4';
                document.getElementById('question-count-select').disabled = true;
            } else {
                countGroup.style.opacity = '1';
                document.getElementById('question-count-select').disabled = false;
            }
        });
    });
    
    // 5. Game Start Quest trigger
    document.getElementById('start-game-btn').addEventListener('click', () => {
        if (questionsDb.length === 0) return;
        
        // Resume Audio context on user gesture
        sounds.init();
        
        const activeModeBtn = document.querySelector('.mode-btn.active');
        const mode = activeModeBtn.dataset.mode;
        const timeLimit = document.getElementById('timer-select').value;
        
        let count = document.getElementById('question-count-select').value;
        if (mode === 'exam') count = '50';
        if (mode === 'endless') count = 'all';
        
        currentGame = new QuizGame(questionsDb, mode, count, timeLimit);
        
        UI.showScreen('game');
        UI.renderQuestion();
    });

    const testQuestionsBtn = document.getElementById('go-to-question-runner-btn');
    if (testQuestionsBtn) {
        testQuestionsBtn.addEventListener('click', () => {
            window.location.href = 'question-runner.html';
        });
    }

    document.getElementById('open-history-btn').addEventListener('click', () => {
        UI.renderHistory();
        UI.showScreen('history');
    });

    document.getElementById('export-history-pdf-btn').addEventListener('click', () => {
        UI.exportHistoryPdf();
    });

    document.getElementById('clear-history-btn').addEventListener('click', () => {
        if (confirm('Clear all saved history? This cannot be undone.')) {
            UI.clearHistory();
        }
    });

    document.getElementById('close-history-btn').addEventListener('click', () => {
        UI.showScreen('lobby');
        UI.updateHeaderStats();
    });
    
    // 6. Next Question click overlay actions
    document.getElementById('next-question-btn').addEventListener('click', () => {
        if (!currentGame) return;
        const q = currentGame.getCurrentQuestion();
        // If this is a multi-select question and answer not yet processed, submit selected options
        if (q && q.isMultiple && !currentGame.answerProcessed) {
            const selectedBtns = Array.from(document.querySelectorAll('.answer-card.multi-selected'));
            const letters = selectedBtns.map(b => b.dataset.option).join('');
            if (!letters) return; // nothing selected yet
            UI.handleAnswerSelect(letters);
            return; // wait for user to click Next again to advance
        }

        // For single-choice require that an answer was already processed (by selecting an option)
        if (!currentGame.answerProcessed) return;
        UI.advanceGame();
    });
    
    // 7. Leaderboard screen continuation trigger
    document.getElementById('leaderboard-next-btn').addEventListener('click', () => {
        const hasNext = currentGame.nextQuestion();
        if (hasNext) {
            UI.showScreen('game');
            UI.renderQuestion();
        } else {
            UI.endGame();
        }
    });
    
    // 8. Lifeline Hint button trigger
    document.getElementById('lifeline-btn').addEventListener('click', () => {
        UI.triggerLifeline();
    });
    
    // 9. Post game actions
    document.getElementById('restart-game-btn').addEventListener('click', () => {
        // Restart with same config
        const activeModeBtn = document.querySelector('.mode-btn.active');
        const mode = activeModeBtn.dataset.mode;
        const timeLimit = document.getElementById('timer-select').value;
        
        let count = document.getElementById('question-count-select').value;
        if (mode === 'exam') count = '50';
        if (mode === 'endless') count = 'all';
        
        currentGame = new QuizGame(questionsDb, mode, count, timeLimit);
        UI.showScreen('game');
        UI.renderQuestion();
    });
    
    document.getElementById('back-lobby-btn').addEventListener('click', () => {
        UI.showScreen('lobby');
        UI.updateHeaderStats();
    });

    const closeImagePopupBtn = document.getElementById('close-image-popup');
    if (closeImagePopupBtn) {
        closeImagePopupBtn.addEventListener('click', () => UI.closeReferenceImagePopup());
    }

    const imagePopupOverlay = document.getElementById('image-popup-overlay');
    if (imagePopupOverlay) {
        imagePopupOverlay.addEventListener('click', (event) => {
            if (event.target === imagePopupOverlay) {
                UI.closeReferenceImagePopup();
            }
        });
    }
});
