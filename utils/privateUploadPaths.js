const path = require('path');
const fs = require('fs');

const uploadRoot = path.join(__dirname, '..', 'public', 'uploads');

const isSafeUploadName = name => typeof name === 'string' && name.length > 0 &&
    !/[\\/:%\x00-\x1f<>"|?*]/.test(name) && !name.startsWith('.') &&
    !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

const isWithin = (root, file) => {
    const relative = path.relative(root, file);
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};

// Call only with a filename obtained from DB metadata, never a client filesystem path.
const resolveUploadFile = name => {
    if (!isSafeUploadName(name)) return null;
    try {
        const file = path.resolve(uploadRoot, name);
        if (!isWithin(uploadRoot, file)) return null;
        const realRoot = fs.realpathSync(uploadRoot);
        const realFile = fs.realpathSync(file);
        if (!isWithin(realRoot, realFile) || !fs.statSync(realFile).isFile()) return null;
        return realFile;
    } catch (error) {
        return null;
    }
};

module.exports = { uploadRoot, isSafeUploadName, resolveUploadFile };
