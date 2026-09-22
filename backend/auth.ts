import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { db } from '@appdeploy/sdk';

const scrypt = promisify(scryptCallback);
const USERS = 'sire_auth_users_v1';
const SESSIONS = 'sire_auth_sessions_v1';
const SESSION_DAYS = 30;

type User = { id:string; email:string; name:string; passwordHash:string; salt:string; createdAt:string; updatedAt:string };
type Session = { id:string; userId:string; expiresAt:string; createdAt:string };

async function hashPassword(password:string, salt:string) {
  const derived = await scrypt(password, salt, 64) as Buffer;
  return derived.toString('hex');
}
function normalizeEmail(value:string) { return value.trim().toLowerCase(); }
function cookie(name:string, value:string, maxAge:number) {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}
function clearCookie(name:string) { return `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`; }
function headerSession(req:any) {
  const raw = String(req.headers?.cookie || '');
  const match = raw.split(';').map((v:string)=>v.trim()).find((v:string)=>v.startsWith('sire_session='));
  return match ? decodeURIComponent(match.slice('sire_session='.length)) : '';
}
async function findUserByEmail(email:string) {
  if (!process.env.DATABASE_URL) throw new Error('Account database is not configured.');
  const result = await db.list<User>(USERS, { limit: 1000 });
  return result.items.find(user => user.email === email) || null;
}
async function findSession(id:string) {
  if (!id || !process.env.DATABASE_URL) return null;
  const result = await db.list<Session>(SESSIONS, { limit: 1000 });
  const session = result.items.find(item => item.id === id);
  if (!session) return null;
  if (Date.parse(session.expiresAt) <= Date.now()) return null;
  return session;
}
export async function currentUser(req:any) {
  const session = await findSession(headerSession(req));
  if (!session) return null;
  const result = await db.list<User>(USERS, { limit: 1000 });
  const user = result.items.find(item => item.id === session.userId);
  return user ? { id:user.id, email:user.email, name:user.name, createdAt:user.createdAt } : null;
}
export async function signup(req:any) {
  const body = req.body || {};
  const email = normalizeEmail(String(body.email || ''));
  const name = String(body.name || '').trim().slice(0,80);
  const password = String(body.password || '');
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Enter a valid email address.');
  if (password.length < 8) throw new Error('Password must be at least 8 characters.');
  if (!process.env.DATABASE_URL) throw new Error('Account database is not configured.');
  if (await findUserByEmail(email)) throw new Error('An account with that email already exists.');
  const now = new Date().toISOString();
  const salt = randomBytes(16).toString('hex');
  const user:User = { id:randomBytes(16).toString('hex'), email, name:name || email.split('@')[0], salt, passwordHash:await hashPassword(password,salt), createdAt:now, updatedAt:now };
  await db.add(USERS, [user]);
  const session = await createSession(user.id);
  return { user:{id:user.id,email:user.email,name:user.name,createdAt:user.createdAt}, setCookie:cookie('sire_session',session.id,SESSION_DAYS*86400) };
}
async function createSession(userId:string) {
  const session:Session = { id:randomBytes(32).toString('hex'), userId, expiresAt:new Date(Date.now()+SESSION_DAYS*86400000).toISOString(), createdAt:new Date().toISOString() };
  await db.add(SESSIONS,[session]);
  return session;
}
export async function login(req:any) {
  const body=req.body||{}; const email=normalizeEmail(String(body.email||'')); const password=String(body.password||'');
  const user=await findUserByEmail(email);
  if (!user) throw new Error('Invalid email or password.');
  const actual=Buffer.from(await hashPassword(password,user.salt)); const expected=Buffer.from(user.passwordHash);
  if (actual.length!==expected.length || !timingSafeEqual(actual,expected)) throw new Error('Invalid email or password.');
  const session=await createSession(user.id);
  return { user:{id:user.id,email:user.email,name:user.name,createdAt:user.createdAt}, setCookie:cookie('sire_session',session.id,SESSION_DAYS*86400) };
}
export async function logout(req:any) {
  return { setCookie:clearCookie('sire_session') };
}
export async function requireUser(req:any) { const user=await currentUser(req); if (!user) throw new Error('Authentication required.'); return user; }
