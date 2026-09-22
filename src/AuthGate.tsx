import { FormEvent, useEffect, useState } from 'react';
import { Mail, Lock, UserRound, LogIn, UserPlus } from 'lucide-react';

export type SireUser = { id:string; email:string; name:string; createdAt:string };

type Props = { user:SireUser|null; onUser:(user:SireUser|null)=>void };

export default function AuthGate({ user, onUser }: Props) {
  const [mode,setMode]=useState<'login'|'signup'>('login');
  const [name,setName]=useState(''); const [email,setEmail]=useState(''); const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  useEffect(()=>{ if(user) return; fetch('/api/auth/me',{credentials:'same-origin',cache:'no-store'}).then(r=>r.json()).then(d=>{if(d.user) onUser(d.user);}).catch(()=>{}); },[user,onUser]);
  if(user) return null;
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError('');try{const endpoint=mode==='login'?'/api/auth/login':'/api/auth/signup';const body=mode==='login'?{email,password}:{name,email,password};const r=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify(body)});const d=await r.json();if(!r.ok)throw new Error(d.error||'Authentication failed.');onUser(d.user);setPassword('');}catch(err){setError(err instanceof Error?err.message:'Authentication failed.');}finally{setBusy(false);}};
  return <div className="sire-auth-overlay"><section className="sire-auth-card">
    <div className="sire-auth-brand"><div className="sire-auth-mark">S</div><div><strong>SIRE</strong><span>Intelligence workspace</span></div></div>
    <div className="sire-auth-heading"><h1>{mode==='login'?'Welcome back':'Create your SIRE account'}</h1><p>{mode==='login'?'Sign in to keep your workspace and conversations synced.':'Create an account to keep your SIRE workspace across devices.'}</p></div>
    <form onSubmit={submit}>
      {mode==='signup'&&<label><span>Name</span><div className="sire-auth-input"><UserRound size={17}/><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" autoComplete="name" required/></div></label>}
      <label><span>Email</span><div className="sire-auth-input"><Mail size={17}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required/></div></label>
      <label><span>Password</span><div className="sire-auth-input"><Lock size={17}/><input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="At least 8 characters" autoComplete={mode==='login'?'current-password':'new-password'} minLength={8} required/></div></label>
      {error&&<div className="sire-auth-error">{error}</div>}
      <button className="sire-auth-submit" disabled={busy}>{mode==='login'?<LogIn size={17}/>:<UserPlus size={17}/>}<span>{busy?'Please wait…':mode==='login'?'Log in':'Create account'}</span></button>
    </form>
    <button className="sire-auth-switch" type="button" onClick={()=>{setMode(mode==='login'?'signup':'login');setError('');}}>{mode==='login'?'New to SIRE? Create an account':'Already have an account? Log in'}</button>
    <small className="sire-auth-note">Your account secures your SIRE workspace and conversation history.</small>
  </section></div>;
}
