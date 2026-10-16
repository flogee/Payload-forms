import crypto from 'crypto';
import { ValidationError } from '../../../errors/index.js';
import { password } from '../../../fields/validations.js';

// OWASP scrypt profile: 32 MiB, N=2^15, r=8, p=3. Use the same
// parameters on Node and Workers; the format identifies them explicitly.
const currentPasswordHashPrefix = 'scrypt-payload-forms-v1-n32768-r8-p3:';
const pbkdf2PasswordHashPrefix = 'pbkdf2-sha256-v1:';
const scryptOptions = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };

export const generatePasswordSaltHash = async ({ collection, isPasswordAuthenticated, password: passwordToSet, req }) => {
    if (!isPasswordAuthenticated) {
        const validationResult = password(passwordToSet, {
            name: 'password', type: 'text', blockData: {}, data: {},
            event: 'submit', path: ['password'], preferences: { fields: {} },
            req, required: true, siblingData: {}
        });
        if (typeof validationResult === 'string') {
            throw new ValidationError({
                collection: collection?.slug,
                errors: [{ message: validationResult, path: 'password' }]
            });
        }
    }
    const saltBuffer = await new Promise((resolve, reject) =>
        crypto.randomBytes(32, (err, salt) => err ? reject(err) : resolve(salt)));
    const salt = saltBuffer.toString('hex');
    const hashRaw = await derivePasswordHash({ password: passwordToSet, salt, algorithm: 'scrypt', keyLength: 32 });
    return { hash: `${currentPasswordHashPrefix}${hashRaw.toString('hex')}`, salt };
};

export const getPasswordHashParameters = (hash) => {
    if (typeof hash !== 'string') throw new Error('Invalid password hash format');
    if (hash.startsWith(currentPasswordHashPrefix)) {
        const value = hash.slice(currentPasswordHashPrefix.length);
        if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid password hash format');
        return { hash: value, algorithm: 'scrypt', iterations: 0, keyLength: 32 };
    }
    if (hash.startsWith(pbkdf2PasswordHashPrefix)) {
        const value = hash.slice(pbkdf2PasswordHashPrefix.length);
        if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Invalid password hash format');
        return { hash: value, algorithm: 'pbkdf2', iterations: 600000, keyLength: 32 };
    }
    if (!/^[a-f0-9]{1024}$/i.test(hash)) throw new Error('Invalid password hash format');
    return { hash, algorithm: 'pbkdf2', iterations: 25000, keyLength: 512 };
};

export const isCurrentPasswordHash = (hash) =>
    typeof hash === 'string' && hash.startsWith(currentPasswordHashPrefix)
    && /^[a-f0-9]{64}$/i.test(hash.slice(currentPasswordHashPrefix.length));

export const derivePasswordHash = ({ algorithm, iterations, keyLength, password, salt }) =>
    new Promise((resolve, reject) => {
        const callback = (err, hash) => err ? reject(err) : resolve(hash);
        if (algorithm === 'scrypt') crypto.scrypt(password, salt, keyLength, scryptOptions, callback);
        else if (algorithm === 'pbkdf2') crypto.pbkdf2(password, salt, iterations, keyLength, 'sha256', callback);
        else reject(new Error('Unsupported password hash algorithm'));
    });
