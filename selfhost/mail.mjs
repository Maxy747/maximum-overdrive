// Outgoing email: sign-up codes and password resets.
// MAX_SMTP_URL: an SMTP connection URL, e.g. smtps://user:app-password@smtp.gmail.com:465 (any provider works).
// MAX_MAIL_FROM: the sender, e.g. "MAX <no-reply@example.com>". Defaults to the SMTP user.
// MAX_MAIL_OUTBOX: a folder; each mail is written there as JSON instead of being sent (tests, debugging).
// In dev mode with neither set, mails are printed to the console so you can sign up locally.
import {mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import nodemailer from 'nodemailer';

const SMTP=process.env.MAX_SMTP_URL||'',OUTBOX=process.env.MAX_MAIL_OUTBOX?resolve(process.env.MAX_MAIL_OUTBOX):'';
const FROM=process.env.MAX_MAIL_FROM||(()=>{try{const u=new URL(SMTP);return decodeURIComponent(u.username)}catch{return ''}})()||'MAX <no-reply@localhost>';
let transport=null;

/** Can the server send email at all? Without it, sign-up by email is off (invites still work). */
export const mailEnabled=(dev=false)=>!!SMTP||!!OUTBOX||dev;

export async function sendMail({to,subject,text},dev=false){
 if(OUTBOX){mkdirSync(OUTBOX,{recursive:true});writeFileSync(join(OUTBOX,`${Date.now()}-${randomUUID()}.json`),JSON.stringify({to,subject,text}));return}
 if(!SMTP){if(dev){console.log(`[mail] to ${to}: ${subject}\n${text}\n`);return}throw Error('Email is not configured.')}
 transport??=nodemailer.createTransport(SMTP);
 await transport.sendMail({from:FROM,to,subject,text});
}
