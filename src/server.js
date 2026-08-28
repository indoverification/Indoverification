import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import 'dotenv/config';

const PORT = Number(process.env.PORT || 10000);
const HOST = '0.0.0.0';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(ROOT, '..', 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const JWT_SECRET = String(process.env.JWT_SECRET || '').trim();
const OTP_TTL_MS = Math.max(60, Number(process.env.OTP_TTL_SECONDS || 600)) * 1000;
const OTP_RESEND_MS = Math.max(15, Number(process.env.OTP_RESEND_SECONDS || 60)) * 1000;
const OTP_MAX_ATTEMPTS = Math.max(1, Number(process.env.OTP_MAX_ATTEMPTS || 5));
const otpStore = new Map();
if (!JWT_SECRET) { console.error('JWT_SECRET is required.'); process.exit(1); }
const transporter = nodemailer.createTransport({host:process.env.SMTP_HOST||'smtp.gmail.com',port:Number(process.env.SMTP_PORT||465),secure:String(process.env.SMTP_SECURE||'true')==='true',auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}});

async function ensureStore(){await fs.mkdir(DATA_DIR,{recursive:true});try{await fs.access(USERS_FILE)}catch{await fs.writeFile(USERS_FILE,'{}','utf8')}}
async function readUsers(){await ensureStore();return JSON.parse(await fs.readFile(USERS_FILE,'utf8'))}
async function writeUsers(users){await ensureStore();const tmp=`${USERS_FILE}.tmp`;await fs.writeFile(tmp,JSON.stringify(users,null,2),'utf8');await fs.rename(tmp,USERS_FILE)}
function sendJson(res,status,body){res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body))}
function setCors(res){res.setHeader('Access-Control-Allow-Origin',process.env.CORS_ORIGIN||'*');res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS')}
async function readBody(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1000000)throw new Error('Request too large')}if(!raw)return {};try{return JSON.parse(raw)}catch{throw new Error('Invalid JSON')}}
function email(v){return String(v||'').trim().toLowerCase()}
function otp(){return String(crypto.randomInt(100000,1000000))}
function hash(value){return crypto.createHash('sha256').update(value).digest('hex')}
function passwordHash(password,salt=crypto.randomBytes(16).toString('hex')){return {salt,hash:crypto.scryptSync(password,salt,64).toString('hex')}}
function passwordOk(password,record){const derived=crypto.scryptSync(password,record.salt,64);const expected=Buffer.from(record.hash,'hex');return expected.length===derived.length&&crypto.timingSafeEqual(expected,derived)}
async function mailOtp(to,code,purpose){await transporter.sendMail({from:process.env.SMTP_FROM||process.env.SMTP_USER,to,subject:`IndoVerification ${purpose} OTP`,text:`Your IndoVerification OTP is ${code}. It expires in ${Math.round(OTP_TTL_MS/60000)} minutes. Do not share this code with anyone.`})}
function issueOtp(key,emailAddress,purpose){const now=Date.now();const prev=otpStore.get(key);if(prev&&now-prev.sentAt<OTP_RESEND_MS)throw new Error('Please wait before requesting another OTP.');const code=otp();otpStore.set(key,{email:emailAddress,purpose,hash:hash(code),sentAt:now,expiresAt:now+OTP_TTL_MS,attempts:0});return code}
function verifyOtp(key,value){const item=otpStore.get(key);if(!item)throw new Error('OTP not found or expired.');if(Date.now()>item.expiresAt){otpStore.delete(key);throw new Error('OTP expired.');}if(item.attempts>=OTP_MAX_ATTEMPTS){otpStore.delete(key);throw new Error('Too many incorrect attempts.');}if(hash(String(value||''))!==item.hash){item.attempts+=1;throw new Error('Invalid OTP.')}otpStore.delete(key);return item}
function tokenFor(user){return jwt.sign({sub:user.id,email:user.email},JWT_SECRET,{expiresIn:'7d',issuer:'IndoVerification'})}

async function main(req,res){setCors(res);if(req.method==='OPTIONS')return sendJson(res,204,{});const u=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);try{
 if(u.pathname==='/health'&&req.method==='GET')return sendJson(res,200,{ok:true,service:'IndoVerification',time:new Date().toISOString()});
 const body=await readBody(req);const users=await readUsers();
 if(u.pathname==='/api/auth/signup/request-otp'&&req.method==='POST'){
  const e=email(body.email),name=String(body.name||'').trim(),password=String(body.password||'');if(!name||!/^\S+@\S+\.\S+$/.test(e)||password.length<8)return sendJson(res,400,{error:'Name, valid email and password (8+ chars) are required.'});if(users[e])return sendJson(res,409,{error:'Account already exists.'});const code=issueOtp(`signup:${e}`,e,'signup');await mailOtp(e,code,'signup verification');return sendJson(res,200,{ok:true,message:'OTP sent to your email.'});
 }
 if(u.pathname==='/api/auth/signup/verify-otp'&&req.method==='POST'){
  const e=email(body.email),verification=verifyOtp(`signup:${e}`,body.otp),name=String(body.name||'').trim(),password=String(body.password||'');if(verification.email!==e)return sendJson(res,400,{error:'OTP request mismatch.'});if(!name||password.length<8)return sendJson(res,400,{error:'Invalid signup data.'});const p=passwordHash(password),user={id:crypto.randomUUID(),email:e,name,createdAt:new Date().toISOString(),password:p};users[e]=user;await writeUsers(users);return sendJson(res,201,{ok:true,token:tokenFor(user),user:{id:user.id,email:e,name}});
 }
 if(u.pathname==='/api/auth/login/request-otp'&&req.method==='POST'){
  const e=email(body.email),password=String(body.password||''),user=users[e];if(!user||!passwordOk(password,user.password))return sendJson(res,401,{error:'Invalid email or password.'});const code=issueOtp(`login:${e}`,e,'login');await mailOtp(e,code,'login verification');return sendJson(res,200,{ok:true,message:'OTP sent to your email.'});
 }
 if(u.pathname==='/api/auth/login/verify-otp'&&req.method==='POST'){
  const e=email(body.email),v=verifyOtp(`login:${e}`,body.otp),user=users[e];if(v.email!==e||!user)return sendJson(res,401,{error:'Verification failed.'});return sendJson(res,200,{ok:true,token:tokenFor(user),user:{id:user.id,email:e,name:user.name}});
 }
 if(u.pathname==='/api/auth/resend-otp'&&req.method==='POST'){
  const e=email(body.email),purpose=String(body.purpose||'signup');if(!['signup','login'].includes(purpose))return sendJson(res,400,{error:'Invalid OTP purpose.'});const user=users[e];if(purpose==='signup'&&user)return sendJson(res,409,{error:'Account already exists.'});if(purpose==='login'&&!user)return sendJson(res,404,{error:'Account not found.'});const code=issueOtp(`${purpose}:${e}`,e,purpose);await mailOtp(e,code,purpose);return sendJson(res,200,{ok:true,message:'OTP resent.'});
 }
 return sendJson(res,404,{error:'Not found'});
}catch(error){console.error(error);return sendJson(res,500,{error:error instanceof Error?error.message:'Server error'})}}
http.createServer(main).listen(PORT,HOST,()=>console.log(`IndoVerification listening on ${HOST}:${PORT}`));
