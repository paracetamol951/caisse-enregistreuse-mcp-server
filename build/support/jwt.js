import 'dotenv/config';
import { SignJWT, jwtVerify } from 'jose';
const secret = new TextEncoder().encode(process.env.MCP_JWT_SECRET || 'change-me');
export async function issueMcpToken(claims, ttlSeconds = 3600) {
    const now = Math.floor(Date.now() / 1000);
    return await new SignJWT({ ...claims })
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setIssuedAt(now)
        .setExpirationTime(now + ttlSeconds)
        .setIssuer('caisse-mcp')
        .sign(secret);
}
export async function verifyMcpToken(token) {
    const { payload } = await jwtVerify(token, secret, { issuer: 'caisse-mcp' });
    return payload;
}
