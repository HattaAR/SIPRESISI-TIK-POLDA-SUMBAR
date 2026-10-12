(() => {
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!token) return;
    const unsafeMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
    const sameOrigin = url => new URL(url, window.location.href).origin === window.location.origin;

    // Existing JSON and FormData callers keep their bodies/content types unchanged.
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input, init = {}) => {
        const request = input instanceof Request ? input : null;
        const url = request ? request.url : String(input);
        const method = (init.method || request?.method || 'GET').toUpperCase();
        if (!unsafeMethods.has(method) || !sameOrigin(url)) return originalFetch(input, init);
        const headers = new Headers(request?.headers);
        new Headers(init.headers).forEach((value, name) => headers.set(name, value));
        headers.set('X-CSRF-Token', token);
        return originalFetch(input, { ...init, headers });
    };

    function protectForm(form) {
        if (!unsafeMethods.has(form.method.toUpperCase()) || !sameOrigin(form.action)) return;
        let field = form.querySelector('input[name="_csrf"]');
        if (!field) {
            field = document.createElement('input');
            field.type = 'hidden';
            field.name = '_csrf';
            form.appendChild(field);
        }
        field.value = token;
    }
    document.addEventListener('submit', event => {
        if (event.target instanceof HTMLFormElement) protectForm(event.target);
    }, true);
    const protectForms = () => document.querySelectorAll('form').forEach(protectForm);
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', protectForms);
    else protectForms();
})();
