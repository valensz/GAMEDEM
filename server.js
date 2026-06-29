const path = require('path');
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const TESTS_FILE = path.join(DATA_DIR, 'tests.json');
const TEST_IMAGES_DIR = path.join(DATA_DIR, 'images');
const DB_PATH = process.env.QUIZ_DB_PATH || path.join(DATA_DIR, 'quiz.db');

let db = null;
let useDb = false;

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(TEST_IMAGES_DIR)) {
  fs.mkdirSync(TEST_IMAGES_DIR, { recursive: true });
}

try {
  const Database = require('better-sqlite3');
  db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.prepare(`
    CREATE TABLE IF NOT EXISTS tests (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS questions (
      test_id TEXT NOT NULL,
      question_id INTEGER NOT NULL,
      question TEXT NOT NULL,
      options TEXT NOT NULL,
      answer TEXT NOT NULL,
      PRIMARY KEY (test_id, question_id),
      FOREIGN KEY (test_id) REFERENCES tests(id) ON DELETE CASCADE
    )
  `).run();
  useDb = true;
  console.log(`Using SQLite database at ${DB_PATH}`);
} catch (err) {
  console.warn('better-sqlite3 is not available, falling back to JSON files.', err.message);
}

function readTests() {
  if (useDb) {
    return db.prepare('SELECT id, name, source, created_at AS createdAt FROM tests ORDER BY created_at').all();
  }

  if (!fs.existsSync(TESTS_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(TESTS_FILE, 'utf8')) || [];
  } catch (err) {
    console.error('Failed reading tests metadata', err);
    return [];
  }
}

function writeTests(tests) {
  if (useDb) return;
  fs.writeFileSync(TESTS_FILE, JSON.stringify(tests, null, 2), 'utf8');
}

function questionsFilePath(testId) {
  return path.join(DATA_DIR, `test-${testId}.json`);
}

function readTestQuestions(testId) {
  if (useDb) {
    const rows = db.prepare('SELECT question_id AS id, question, options, answer FROM questions WHERE test_id = ? ORDER BY question_id').all(testId);
    return rows.map(row => ({
      ...row,
      options: JSON.parse(row.options || '{}')
    }));
  }

  const filePath = questionsFilePath(testId);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) || [];
  } catch (err) {
    console.error('Failed reading test questions', err);
    return null;
  }
}

function createTestRecord(test, questions) {
  if (useDb) {
    const insertTest = db.prepare('INSERT INTO tests (id, name, source, created_at) VALUES (?, ?, ?, ?)');
    const insertQuestion = db.prepare('INSERT INTO questions (test_id, question_id, question, options, answer) VALUES (?, ?, ?, ?, ?)');
    const transaction = db.transaction((newTest, questionList) => {
      insertTest.run(newTest.id, newTest.name, newTest.source, newTest.createdAt);
      for (const question of questionList) {
        insertQuestion.run(newTest.id, question.id, question.question, JSON.stringify(question.options || {}), String(question.answer || ''));
      }
    });
    transaction(test, questions);
    return;
  }

  const tests = readTests();
  tests.push(test);
  writeTests(tests);
  fs.writeFileSync(questionsFilePath(test.id), JSON.stringify(questions, null, 2), 'utf8');
}

function deleteTestRecord(testId) {
  if (useDb) {
    const result = db.prepare('DELETE FROM tests WHERE id = ?').run(testId);
    return result.changes > 0;
  }

  const tests = readTests();
  const updated = tests.filter(t => t.id !== testId);
  if (updated.length === tests.length) {
    return false;
  }

  writeTests(updated);
  return true;
}

function clearAllTestsRecords() {
  if (useDb) {
    db.prepare('DELETE FROM questions').run();
    db.prepare('DELETE FROM tests').run();
    return;
  }

  writeTests([]);
}

function deleteTestFiles(testId) {
  const filePath = questionsFilePath(testId);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function imageFolderPath(testId) {
  return path.join(TEST_IMAGES_DIR, String(testId));
}

function ensureImageFolder(testId) {
  const folder = imageFolderPath(testId);
  if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function readTestImageFiles(testId) {
  const folder = imageFolderPath(testId);
  if (!fs.existsSync(folder)) return [];
  return fs.readdirSync(folder).filter(name => !name.startsWith('.'));
}

function safeFileName(filename) {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function deleteTestAssets(testId) {
  deleteTestFiles(testId);
  const folder = imageFolderPath(testId);
  if (fs.existsSync(folder)) {
    fs.rmSync(folder, { recursive: true, force: true });
  }
}

async function parsePdfBuffer(buffer, onProgress) {
  let data;
  if (typeof Buffer !== 'undefined' && Buffer.isBuffer(buffer)) {
    data = new Uint8Array(buffer);
  } else if (buffer instanceof Uint8Array) {
    data = buffer;
  } else {
    data = new Uint8Array(buffer);
  }
  const loadingTask = pdfjsLib.getDocument({ data });
  const pdf = await loadingTask.promise;
  const numPages = pdf.numPages;
  let fullText = '';

  for (let pageNumber = 1; pageNumber <= numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    let lastY = null;
    let pageText = '';

    for (const item of textContent.items) {
      const currentY = item.transform[5];
      if (lastY !== null && Math.abs(currentY - lastY) > 8) {
        pageText += '\n';
      }
      pageText += item.str + ' ';
      lastY = currentY;
    }

    fullText += `\n\n--- PAGE ${pageNumber} ---\n\n${pageText}`;
    if (typeof onProgress === 'function') {
      onProgress(pageNumber, numPages);
    }
  }

  const parts = fullText.split(/Question\s*#?/i);
  const parsedQuestions = [];

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i].trim();
    if (!part) continue;
    try {
      const numMatch = part.match(/^(\d+)/);
      if (!numMatch) continue;
      const qId = parseInt(numMatch[1], 10);
      const ansIndex = part.search(/Correct\s+Answer\s*:/i);
      if (ansIndex === -1) continue;

      const bodyAndOptions = part.substring(0, ansIndex).trim();
      const answerSection = part.substring(ansIndex).trim();
      const ansMatch = answerSection.match(/Correct\s+Answer\s*:\s*([A-E]+)/i);
      if (!ansMatch) continue;
      const correctAnswer = ansMatch[1].trim().toUpperCase();

      const idxA = bodyAndOptions.search(/\bA\./i);
      const idxB = bodyAndOptions.search(/\bB\./i);
      const idxC = bodyAndOptions.search(/\bC\./i);
      const idxD = bodyAndOptions.search(/\bD\./i);
      const idxE = bodyAndOptions.search(/\bE\./i);
      if (idxA === -1 || idxB === -1 || idxC === -1 || idxD === -1) continue;

      const questionText = bodyAndOptions.substring(0, idxA).trim();
      const optA = bodyAndOptions.substring(idxA, idxB).replace(/^\s*A\.\s*/i, '').trim();
      const optB = bodyAndOptions.substring(idxB, idxC).replace(/^\s*B\.\s*/i, '').trim();
      const optC = bodyAndOptions.substring(idxC, idxD).replace(/^\s*C\.\s*/i, '').trim();
      const optD = (idxE === -1)
        ? bodyAndOptions.substring(idxD).replace(/^\s*D\.\s*/i, '').trim()
        : bodyAndOptions.substring(idxD, idxE).replace(/^\s*D\.\s*/i, '').trim();
      const optE = (idxE === -1)
        ? null
        : bodyAndOptions.substring(idxE).replace(/^\s*E\.\s*/i, '').trim();

      const options = { A: optA, B: optB, C: optC, D: optD };
      if (optE) options.E = optE;

      parsedQuestions.push({ id: qId, question: questionText, options, answer: correctAnswer });
    } catch (err) {
      console.warn('Failed parsing question chunk', err);
      continue;
    }
  }

  return parsedQuestions;
}

app.use(express.static(path.join(__dirname)));
app.use('/data', express.static(DATA_DIR));
app.use('/test-images', express.static(TEST_IMAGES_DIR));

app.get('/api/tests', (req, res) => {
  const tests = readTests();
  res.json({ tests });
});

app.get('/api/tests/:testId', (req, res) => {
  const tests = readTests();
  const test = tests.find(t => t.id === req.params.testId);
  if (!test) {
    return res.status(404).json({ error: 'Test not found.' });
  }
  const questions = readTestQuestions(test.id);
  if (!questions) {
    return res.status(500).json({ error: 'Questions file missing.' });
  }
  res.json({ ...test, questions });
});

app.get('/api/questions', (req, res) => {
  const tests = readTests();
  if (!tests.length) {
    return res.status(404).json({ error: 'No tests available.' });
  }

  const testId = req.query.testId;
  const test = testId ? tests.find(t => t.id === testId) : tests[0];
  if (!test) {
    return res.status(404).json({ error: 'Test not found.' });
  }

  const questions = readTestQuestions(test.id);
  if (!questions) {
    return res.status(500).json({ error: 'Questions file missing.' });
  }

  res.json({ id: test.id, name: test.name, source: test.source, questions });
});

app.get('/api/tests/:testId/images', (req, res) => {
  const tests = readTests();
  const test = tests.find(t => t.id === req.params.testId);
  if (!test) {
    return res.status(404).json({ error: 'Test not found.' });
  }
  const images = readTestImageFiles(test.id);
  return res.json({ testId: test.id, images });
});

app.post('/api/tests/:testId/images', upload.array('images'), (req, res) => {
  const tests = readTests();
  const test = tests.find(t => t.id === req.params.testId);
  if (!test) {
    return res.status(404).json({ error: 'Test not found.' });
  }
  if (!req.files || !req.files.length) {
    return res.status(400).json({ error: 'No image files were uploaded.' });
  }

  const folder = ensureImageFolder(test.id);
  const uploaded = [];
  for (const file of req.files) {
    const safeName = safeFileName(file.originalname);
    fs.writeFileSync(path.join(folder, safeName), file.buffer);
    uploaded.push(safeName);
  }

  return res.json({ success: true, testId: test.id, uploaded });
});

app.delete('/api/tests/:testId/images/:imageName', (req, res) => {
  const tests = readTests();
  const test = tests.find(t => t.id === req.params.testId);
  if (!test) {
    return res.status(404).json({ error: 'Test not found.' });
  }

  const imageName = safeFileName(req.params.imageName);
  const imagePath = path.join(imageFolderPath(test.id), imageName);
  if (!fs.existsSync(imagePath)) {
    return res.status(404).json({ error: 'Image not found.' });
  }

  fs.unlinkSync(imagePath);
  return res.json({ success: true, deleted: imageName });
});

app.post('/api/tests', upload.single('pdf'), async (req, res) => {
  const testName = String(req.body.name || '').trim();
  if (!req.file || !testName) {
    return res.status(400).json({ error: 'PDF file and test name are required.' });
  }

  try {
    const questions = await parsePdfBuffer(req.file.buffer);
    if (!questions || questions.length === 0) {
      return res.status(422).json({ error: 'No questions could be extracted from PDF.' });
    }

    const newTest = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      name: testName,
      source: req.file.originalname || 'uploaded.pdf',
      createdAt: new Date().toISOString()
    };

    createTestRecord(newTest, questions);

    return res.json({ success: true, test: newTest, count: questions.length });
  } catch (err) {
    console.error('Upload error', err);
    return res.status(500).json({ error: 'Failed to parse PDF file.' });
  }
});

app.delete('/api/tests/:testId', (req, res) => {
  const removed = deleteTestRecord(req.params.testId);
  if (!removed) {
    return res.status(404).json({ error: 'Test not found.' });
  }

  deleteTestAssets(req.params.testId);
  return res.json({ success: true });
});

app.delete('/api/questions', (req, res) => {
  try {
    const tests = readTests();
    tests.forEach(t => deleteTestAssets(t.id));
    if (fs.existsSync(TEST_IMAGES_DIR)) {
      fs.rmSync(TEST_IMAGES_DIR, { recursive: true, force: true });
      fs.mkdirSync(TEST_IMAGES_DIR, { recursive: true });
    }
    clearAllTestsRecords();
    return res.json({ success: true });
  } catch (err) {
    console.error('Failed to clear all tests', err);
    return res.status(500).json({ error: 'Failed to clear all tests.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
