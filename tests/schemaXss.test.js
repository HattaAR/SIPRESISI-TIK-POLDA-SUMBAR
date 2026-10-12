const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ejs = require('ejs');
const puppeteer = require('puppeteer');

const root = path.join(__dirname, '..');
const inert = '</script><script type="application/x-inert" data-fixture="inert">fixture</script><img data-fixture="inert"> & " \' \u2028\u2029';
const domInert = '"><img data-fixture="inert"> & <b>fixture</b>';
const fields = [
    { label: 'Nama', type: 'text', key: 'nama' },
    { label: 'Isi', type: 'textarea', key: 'isi' },
    { label: 'Tanggal', type: 'date', key: 'tanggal' },
    { label: '', type: 'text', key: '' },
    { label: 'Nama lagi', type: 'text', key: 'nama' }
];

function updateSchema(body, error = null, affectedRows = 1) {
    const controller = {};
    const queries = [];
    const response = { status: 200 };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'controllers/typeController.js'), 'utf8'), {
        exports: controller,
        require(specifier) {
            if (specifier === '../config/database') return {
                callbackPool: { query(sql, params, callback) {
                    queries.push({ sql, params: Array.from(params) });
                    callback(error, { affectedRows });
                } }
            };
            return require(specifier);
        }
    });
    controller.updateSchemaActive({ body, params: { id: '12' } }, {
        status(code) { response.status = code; return this; },
        json(value) { response.body = JSON.parse(JSON.stringify(value)); }
    });
    return { ...response, queries };
}

test('valid schema preserves the exact stored string, order, SQL, and success response', () => {
    const schema = JSON.stringify(fields, null, 2);
    const result = updateSchema({ schema });
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { message: 'Sukses' });
    assert.deepEqual(result.queries, [{
        sql: 'UPDATE letter_types SET form_schema = ? WHERE id = ?', params: [schema, '12']
    }]);
});

test('empty schema remains valid', () => {
    assert.equal(updateSchema({ schema: '[]' }).status, 200);
});

test('invalid schema stops with 400 before any database query', () => {
    const invalid = [{ schema: 'not-json' }, undefined, null, {}, { schema: [] }, { schema: null }, { schema: '' },
        { schema: '{}' }, { schema: 'null' },
        ...[null, [], {}, { label: 'A', type: 'text' },
            { label: 1, type: 'text', key: 'a' }, { label: 'A', type: 'select', key: 'a' },
            { label: 'A', type: 'text', key: 1 },
            { label: 'A', type: 'text', key: 'a', options: [inert] }
        ].map(field => ({ schema: JSON.stringify([field]) }))];
    for (const body of invalid) {
        const result = updateSchema(body);
        assert.equal(result.status, 400, JSON.stringify(body));
        assert.equal(result.queries.length, 0);
        assert.equal(typeof result.body.message, 'string');
    }
});

test('labels and keys remain text data, including inert markup', () => {
    const schema = JSON.stringify([{ label: inert, type: 'text', key: inert }]);
    const result = updateSchema({ schema });
    assert.equal(result.status, 200);
    assert.equal(result.queries[0].params[0], schema);
});

test('valid schema keeps the existing database-error response', () => {
    const result = updateSchema({ schema: JSON.stringify(fields) }, new Error('Fixture DB error'));
    assert.equal(result.status, 500);
    assert.deepEqual(result.body, { message: 'Gagal' });
    assert.equal(result.queries.length, 1);
});

test('affectedRows zero keeps the existing success response', () => {
    const result = updateSchema({ schema: JSON.stringify(fields) }, null, 0);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body, { message: 'Sukses' });
});

let browser;
before(async () => { browser = await puppeteer.launch({ headless: true }); });
after(async () => { if (browser) await browser.close(); });

async function renderPage(view, schema = fields, content = null, extras = {}) {
    const type = { id: 12, name: 'Fixture jenis', code_prefix: 'FIX',
        letter_number_format: '{nomor}/{tahun}', template_path: 'fixture.docx',
        form_schema: JSON.stringify(schema), ...extras };
    const html = ejs.render(fs.readFileSync(path.join(root, 'views', view + '.ejs'), 'utf8'), {
        title: 'Fixture', page: view === 'admin/types' ? 'types' : 'create',
        user: { id: 7, full_name: 'Fixture User', role: view === 'admin/types' ? 'admin' : 'staff' },
        types: [type], isEdit: content !== null,
        letter: content !== null ? { id: 22, type_id: 12, subject: 'Fixture perihal' } : null, content
    }, { filename: path.join(root, 'views', view + '.ejs') });
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on('request', request => request.abort());
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(html, { waitUntil: 'domcontentloaded' });
    return { page, errors };
}

test('both views serialize inert label/key/options without breaking out of script', async () => {
    for (const view of ['admin/types', 'staff/create']) {
        const schema = [{ label: inert, type: 'text', key: inert, options: [inert] }];
        const { page, errors } = await renderPage(view, schema, null, { name: inert });
        try {
            assert.deepEqual(errors, []);
            assert.equal(await page.$$eval('[data-fixture="inert"]', nodes => nodes.length), 0);
            const value = await page.evaluate(view => {
                const data = view === 'admin/types' ? allData : allTypes;
                return JSON.parse(data[0].form_schema);
            }, view);
            assert.deepEqual(value, schema);
        } finally { await page.close(); }
    }
});

test('staff edit serializes saved content without breaking out of script', async () => {
    const { page, errors } = await renderPage('staff/create', fields, { nama: inert, isi: inert });
    try {
        assert.deepEqual(errors, []);
        assert.equal(await page.$$eval('[data-fixture="inert"]', nodes => nodes.length), 0);
        assert.equal(await page.$eval('input[name="nama"]', input => input.value), inert);
        assert.equal(await page.$eval('textarea[name="isi"]', input => input.value), inert);
    } finally { await page.close(); }
});

test('admin schema editor uses literal values, never an HTML sink for schema text', async () => {
    const { page } = await renderPage('admin/types', [{ label: domInert, type: 'text', key: domInert }]);
    try {
        await page.evaluate(() => {
            const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
            Object.defineProperty(Element.prototype, 'innerHTML', { ...descriptor,
                set(value) { if (String(value).includes('data-fixture')) throw Error('Unsafe schema HTML sink'); descriptor.set.call(this, value); }
            });
            bukaModalSchema(12);
        });
        assert.deepEqual(await page.$$eval('#schemaContainer input', nodes => nodes.map(node => node.value)), [domInert, domInert]);
        assert.equal(await page.$$eval('#schemaContainer [data-fixture]', nodes => nodes.length), 0);
    } finally { await page.close(); }
});

test('staff dynamic controls use literal schema text and preserve their field names', async () => {
    const schema = [{ label: domInert, type: 'textarea', key: domInert }];
    const { page } = await renderPage('staff/create', schema);
    try {
        await page.evaluate(() => {
            const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
            Object.defineProperty(Element.prototype, 'innerHTML', { ...descriptor,
                set(value) { if (String(value).includes('data-fixture')) throw Error('Unsafe draft HTML sink'); descriptor.set.call(this, value); }
            });
            document.getElementById('jenisSurat').value = '12'; loadFormSchema();
        });
        assert.equal(await page.$eval('#dynamicFormContainer label', node => node.textContent), domInert);
        assert.equal(await page.$eval('#dynamicFormContainer textarea', node => node.name), domInert);
        assert.equal(await page.$$eval('#dynamicFormContainer [data-fixture]', nodes => nodes.length), 0);
    } finally { await page.close(); }
});

test('selected filename is literal text and retains the Word icon', async () => {
    const { page } = await renderPage('admin/types');
    try {
        await page.evaluate(name => updateFileName({ files: [{ name }] }), inert + '.docx');
        assert.equal(await page.$$eval('#fileNameDisplay [data-fixture]', nodes => nodes.length), 0);
        assert.equal(await page.$eval('#fileNameDisplay', node => node.textContent), ' ' + inert + '.docx');
        assert.equal(await page.$$eval('#fileNameDisplay i.fa-file-word', nodes => nodes.length), 1);
    } finally { await page.close(); }
});

test('valid staff create/edit keep field order, classes, values and form data', async () => {
    for (const content of [null, { nama: 'Nama fixture', isi: 'Isi\nfixture', tanggal: '2026-10-04' }]) {
        const { page, errors } = await renderPage('staff/create', fields, content);
        try {
            if (!content) await page.evaluate(() => { document.getElementById('jenisSurat').value = '12'; loadFormSchema(); });
            assert.deepEqual(errors, []);
            const controls = await page.$$eval('#dynamicFormContainer input, #dynamicFormContainer textarea', nodes => nodes.map(node => ({
                name: node.name, type: node.type, value: node.value, className: node.className
            })));
            assert.deepEqual(controls, [
                { name: 'nama', type: 'text', value: content ? 'Nama fixture' : '', className: 'form-control-modern' },
                { name: 'isi', type: 'textarea', value: content ? 'Isi\nfixture' : '', className: 'form-control-modern' },
                { name: 'tanggal', type: 'date', value: content ? '2026-10-04' : '', className: 'form-control-modern' },
                { name: '', type: 'text', value: '', className: 'form-control-modern' },
                { name: 'nama', type: 'text', value: content ? 'Nama fixture' : '', className: 'form-control-modern' }
            ]);
            assert.equal(await page.$eval('#btnSave', node => node.disabled), false);
            assert.equal(await page.$eval('#dynamicFormContainer textarea', node => node.parentElement.style.gridColumn), 'span 2');
            if (content) assert.deepEqual(await page.evaluate(() => Object.fromEntries(new FormData(document.getElementById('createLetterForm')))), {
                nama: 'Nama fixture', isi: 'Isi\nfixture', tanggal: '2026-10-04'
            });
        } finally { await page.close(); }
    }
});

test('admin editor preserves type selection, key normalization, add/remove and schema payload order', async () => {
    const { page, errors } = await renderPage('admin/types');
    try {
        await page.evaluate(() => bukaModalSchema(12));
        assert.deepEqual(errors, []);
        assert.deepEqual(await page.$$eval('#schemaContainer select', nodes => nodes.map(node => node.value)), ['text', 'textarea', 'date', 'text', 'text']);
        const schema = await page.evaluate(() => {
            const inputs = document.querySelectorAll('#schemaContainer input');
            inputs[0].value = 'Nama baru'; inputs[0].dispatchEvent(new Event('input'));
            inputs[1].value = 'KEY 1'; inputs[1].dispatchEvent(new Event('input'));
            tambahBarisSchema();
            document.querySelector('#schemaContainer > div:last-child button').click();
            return currentSchema;
        });
        assert.deepEqual(schema, [{ label: 'Nama baru', type: 'text', key: 'key1' }, ...fields.slice(1)]);
    } finally { await page.close(); }
});
