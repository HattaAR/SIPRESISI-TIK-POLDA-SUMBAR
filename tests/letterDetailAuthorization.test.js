const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../controllers/letterDetailController.js'), 'utf8');
const mainSql = 'SELECT l.*, u.full_name as user_name, u.nrp, t.name as type_name FROM letters l JOIN users u ON l.user_id = u.id LEFT JOIN letter_types t ON l.type_id = t.id WHERE l.id = ?';
const dispositionSql = 'SELECT 1 FROM dispositions WHERE letter_id = ? AND receiver_id = ? LIMIT 1';

const makeLetter = () => ({
    id: 100, type_id: 3, user_id: 42, subject: 'Fixture surat', urgency: 'NORMAL',
    letter_number: null, letter_date: null, content_data: '{"isi":"Fixture isi"}',
    status: 'DRAFT', rejection_reason: 'Fixture alasan', pdf_path: null,
    created_at: '2026-01-01', updated_at: '2026-01-02', pimpinan_note: 'Fixture catatan',
    origin_type: 'INTERNAL', external_sender: null, recipient: 'Fixture penerima',
    approver_id: null, user_name: 'Fixture pengirim', nrp: 'fixture', type_name: 'Fixture jenis'
});

function invoke({ role = 'staff', userId = 42, letter = makeLetter(), mainError = null,
    dispositions = [], dispositionError = null } = {}) {
    const queries = [];
    const response = { status: 200 };
    const controller = {};
    const pool = {
        query(sql, params, callback) {
            queries.push({ sql: sql.trim().replace(/\s+/g, ' '), params: Array.from(params) });
            if (queries.length === 1) {
                assert.equal(queries[0].sql, mainSql);
                assert.deepEqual(queries[0].params, ['100']);
                callback(mainError, letter ? [letter] : []);
            } else {
                assert.equal(queries.length, 2, 'Authorization must not issue additional queries');
                assert.equal(queries[1].sql, dispositionSql);
                assert.deepEqual(queries[1].params, ['100', userId]);
                callback(dispositionError, dispositions);
            }
        }
    };
    vm.runInNewContext(source, {
        exports: controller,
        require(specifier) {
            assert.equal(specifier, '../config/database');
            return { callbackPool: pool };
        }
    });
    controller.getLetterDetail({ params: { id: '100' }, user: { id: userId, role } }, {
        status(code) {
            response.status = code;
            return this;
        },
        json(body) {
            assert.equal(response.body, undefined, 'Response must be sent once');
            response.body = JSON.parse(JSON.stringify(body));
        }
    });
    return { ...response, queries };
}

for (const role of ['admin', 'pimpinan']) {
    test(`${role} reads the full existing response without a disposition lookup`, () => {
        const letter = makeLetter();
        const result = invoke({ role, userId: 99, letter });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, { data: { ...letter, content_data: { isi: 'Fixture isi' } } });
        assert.equal(result.queries.length, 1);
    });
}

test('staff owner reads the full existing response without a disposition lookup', () => {
    const letter = makeLetter();
    const result = invoke({ letter });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { data: { ...letter, content_data: { isi: 'Fixture isi' } } });
    assert.equal(result.queries.length, 1);
});

test('staff disposition receiver reads the same full response after a relation lookup', () => {
    const letter = makeLetter();
    const result = invoke({ userId: 99, letter, dispositions: [{ 1: 1 }] });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { data: { ...letter, content_data: { isi: 'Fixture isi' } } });
    assert.equal(result.queries.length, 2);
});

test('staff without ownership or a disposition receives 403 without any letter data', () => {
    const result = invoke({ userId: 99 });
    assert.equal(result.status, 403);
    assert.deepEqual(result.body, { message: 'Akses ditolak!' });
    assert.equal(result.queries.length, 2);
});

test('missing letter and main database error keep the existing JSON 404', () => {
    for (const options of [{ letter: null }, { mainError: new Error('Fixture DB error') }]) {
        const result = invoke(options);
        assert.equal(result.status, 404);
        assert.deepEqual(result.body, { message: 'Surat tidak ditemukan' });
        assert.equal(result.queries.length, 1);
    }
});

test('disposition lookup error fails closed with the existing database-error response', () => {
    const result = invoke({ userId: 99, dispositionError: new Error('Fixture relation error') });
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { message: 'Surat tidak ditemukan' });
    assert.equal(result.queries.length, 2);
});

test('authorized malformed JSON and Buffer content preserve the existing serialization', () => {
    for (const content_data of ['not-json', Buffer.from('Fixture bytes')]) {
        const letter = { ...makeLetter(), content_data };
        const result = invoke({ letter });
        assert.equal(result.status, 200);
        assert.deepEqual(result.body, JSON.parse(JSON.stringify({ data: letter })));
    }
});
