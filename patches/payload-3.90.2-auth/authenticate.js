import crypto from 'crypto';
import { derivePasswordHash, getPasswordHashParameters, isCurrentPasswordHash } from './generatePasswordSaltHash.js';

export const authenticateLocalStrategy = async ({ doc, password }) => {
    try {
        const { hash, salt } = doc;
        if (typeof salt !== 'string' || !/^[a-f0-9]{64}$/i.test(salt) || typeof password !== 'string') return null;
        const parameters = getPasswordHashParameters(hash);
        const hashBuffer = await derivePasswordHash({ ...parameters, password, salt });
        const storedHashBuffer = Buffer.from(parameters.hash, 'hex');
        if (hashBuffer.length !== storedHashBuffer.length || !crypto.timingSafeEqual(hashBuffer, storedHashBuffer)) return null;
        return { doc, shouldUpdatePasswordHash: !isCurrentPasswordHash(hash) };
    } catch {
        return null;
    }
};
