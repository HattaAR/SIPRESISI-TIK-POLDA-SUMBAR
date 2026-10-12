const test = require('node:test');
const assert = require('node:assert/strict');
const { requireRole } = require('../middleware/roleMiddleware');

test('unauthorized role receives the existing JSON 403 contract before next', () => {
    let nextCalled = false;
    let responseBody;
    const res = {
        status(code) {
            assert.equal(code, 403);
            return this;
        },
        json(body) {
            responseBody = body;
        }
    };

    requireRole('admin')({ user: { role: 'staff' } }, res, () => {
        nextCalled = true;
    });

    assert.deepEqual(responseBody, { message: 'Akses ditolak!' });
    assert.equal(nextCalled, false);
});

test('allowed role reaches the existing controller', () => {
    let nextCalled = false;
    const res = {
        status() {
            throw new Error('Authorized role must not receive an error response');
        }
    };

    requireRole('admin', 'kasubbag')({ user: { role: 'kasubbag' } }, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
});
