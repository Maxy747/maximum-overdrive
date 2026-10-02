// /privacy and /terms: plain pages generated from this server's own settings, so they describe what it actually does
// (which email and AI services are used, how long things are kept). Whoever runs the server should read them and
// can replace them with their own pages (MAX_PRIVACY_URL, MAX_TERMS_URL). They're a starting point, not legal advice.
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const hostOf=u=>{try{return new URL(u).hostname}catch{return ''}};

function page(title,appName,body){
 return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} · ${esc(appName)}</title>
<style>:root{color-scheme:dark}body{margin:0;background:#100e18;color:#e9e3f2;font:16px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif}
main{max-width:760px;margin:0 auto;padding:40px 20px 80px}h1{font-size:30px;margin:0 0 4px}h2{font-size:19px;margin:32px 0 8px;color:#d9c8ff}
p,li{color:#cfc6dc}a{color:#c1a0ff}.muted{color:#9a91a8;font-size:14px}ul{padding-left:22px}</style></head>
<body><main>${body}<p class="muted"><a href="./">Back to ${esc(appName)}</a></p></main></body></html>`;
}

/** cfg: {appName, operator, contact, origin, smtpHost, coachHost, coachLocal, storageMb, trashDays, unverifiedHours, backupDays, minAge, updated} */
export function privacyPage(c){
 const who=esc(c.operator||hostOf(c.origin)||'the person who runs this server'),contact=c.contact?`<a href="mailto:${esc(c.contact)}">${esc(c.contact)}</a>`:'the person who runs this server';
 return page('Privacy policy',c.appName,`<h1>Privacy policy</h1><p class="muted">Last updated ${esc(c.updated)}</p>
<p>${esc(c.appName)} at ${esc(c.origin||'this address')} is run by ${who}. This page explains what it stores about you, who else sees it, and how to get it back or delete it. Questions: ${contact}.</p>
<h2>What is stored</h2><ul>
<li><strong>Your account:</strong> your name, email address, a hashed password (never the password itself), your birthday and profile photo if you add them.</li>
<li><strong>What you put in:</strong> goals and daily check-ins, notes and reflections, your weight goal, moods, journal memories with their photos, places and dates, diary entries, countdowns, hidden photos, and chats with the coach.</li>
<li><strong>To keep you signed in and send reminders:</strong> a session cookie, the push-notification address of each device you turn notifications on for, and your time zone.</li></ul>
<p>There is no advertising, no tracking and no analytics. The only cookie is the one that keeps you signed in (and a short-lived one while hidden photos are unlocked).</p>
<h2>Who can see it</h2><ul>
<li><strong>Only you:</strong> your tracker, your own journal, your hidden photos and your coach chats.</li>
<li><strong>Your partner, if you pair with someone:</strong> your shared journal and its photos, the moods you mark as shared, your answers to the daily question (after they answer), your name, photo and birthday.</li>
<li><strong>Nobody else using this server</strong> can see anything of yours.</li>
<li><strong>The operator</strong> runs the server and can technically access the data on it, for example to keep it working or restore a backup. Data is not end-to-end encrypted.</li></ul>
<h2>Other services involved</h2><ul>
${c.smtpHost?`<li><strong>Email:</strong> sign-up codes and password resets are sent through ${esc(c.smtpHost)}, which receives your email address and the message.</li>`:''}
<li><strong>Push notifications</strong> go through your browser's push service (Apple, Google or Mozilla), which receives the notification text.</li>
<li><strong>Maps:</strong> the journal's map loads map images from OpenStreetMap, and looking up a place sends the search text to OpenStreetMap's Nominatim service. Both see your IP address.</li>
${c.coachHost?`<li><strong>AI coach:</strong> when you use the coach, your goals and progress for the day, your latest mood and your messages are sent to ${esc(c.coachHost)} to write a reply. Your journal and photos are never sent. You can turn the coach off in Profile.</li>`:c.coachLocal?'<li><strong>AI coach:</strong> runs on this server; nothing is sent elsewhere.</li>':''}
</ul>
<h2>How long it's kept</h2><ul>
<li>Your data is kept until you delete it or delete your account.</li>
<li>Deleted journal entries and photos stay in Recently deleted for ${c.trashDays} days, then are removed.</li>
<li>Sign-ups that are never confirmed are removed after ${c.unverifiedHours} hours.</li>
<li>${c.backupDays?`Backups are kept for up to ${c.backupDays} days, so deleted data disappears from them within that time.`:'Backups may keep deleted data for a while after you delete it.'}</li></ul>
<h2>Your choices and rights</h2><ul>
<li><strong>Download everything:</strong> Profile → Export everything gives you a zip of your data and the photos you can see.</li>
<li><strong>Delete your account:</strong> Profile → Delete my account removes your account and everything that's only yours, at once. If you have a partner, your shared journal stays with them.</li>
<li>You can correct your details in Profile at any time. For anything else, contact ${contact}.</li></ul>
<h2>Who can use it</h2><p>You must be at least ${c.minAge} years old.</p>`);
}

export function termsPage(c){
 const who=esc(c.operator||hostOf(c.origin)||'the person who runs this server'),contact=c.contact?`<a href="mailto:${esc(c.contact)}">${esc(c.contact)}</a>`:'the person who runs this server';
 return page('Terms',c.appName,`<h1>Terms of use</h1><p class="muted">Last updated ${esc(c.updated)}</p>
<p>${esc(c.appName)} at ${esc(c.origin||'this address')} is run by ${who} as a personal, free service. By creating an account you agree to these terms and to the <a href="./privacy">privacy policy</a>.</p>
<h2>Your account</h2><ul><li>You must be at least ${c.minAge} years old and use your own email address.</li><li>Keep your password and PIN to yourself; you're responsible for what happens in your account.</li><li>One person per account. Partners each have their own.</li></ul>
<h2>Your content</h2><ul><li>What you write and upload stays yours. You only give the service what it needs to store it and show it to you (and to your partner, for the shared journal).</li>
<li>Don't upload anything illegal, anything you don't have the right to share, or anything about other people they wouldn't want stored.</li>
<li>Each account can store up to ${c.storageMb?`${c.storageMb} MB`:'a fair amount'} of photos.</li></ul>
<h2>The service</h2><ul><li>It's provided as is, for free, without guarantees: it can be down, change or stop. Keep your own copy of what matters (Profile → Export everything).</li>
<li>The coach gives general encouragement, not medical, mental-health, diet or legal advice.</li>
<li>Accounts that break these terms or harm the service can be disabled or removed.</li></ul>
<h2>Contact</h2><p>${contact}.</p>`);
}
