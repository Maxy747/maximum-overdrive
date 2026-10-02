import {build as viteBuild} from 'vite';
import {build as bundle} from 'esbuild';
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
await viteBuild({configFile:'vite.selfhost.config.ts'});
await bundle({entryPoints:['selfhost/server.mjs'],outfile:'selfhost-dist/server.mjs',bundle:true,platform:'node',format:'esm',target:'node24',
 // web-push is CommonJS and require()s Node built-ins; give the ESM bundle a real require.
 banner:{js:"import {createRequire as __createRequire} from 'node:module';const require=__createRequire(import.meta.url);"}});

// Offline app: the service worker keeps the built files plus the images the app actually uses.
// Its version is a hash of those files, so every deploy with changes installs a fresh copy.
const pub='selfhost-dist/public',assets=readdirSync(join(pub,'assets')).map(f=>`assets/${f}`);
const code=['index.html','manifest.webmanifest',...assets].map(f=>readFileSync(join(pub,f),'utf8')).join('\n');
const images=[...new Set(code.match(/[\w.-]+\.(?:png|svg|ico)\b/g)??[])].filter(f=>existsSync(join(pub,f)));
const precache=['manifest.webmanifest',...images,...assets].sort();
const version=createHash('sha256').update(precache.map(f=>f+readFileSync(join(pub,f)).toString('base64')).join('|')).digest('hex').slice(0,12);
const sw=readFileSync(join(pub,'sw.js'),'utf8');
if(!sw.includes("const VERSION='dev';")||!sw.includes('const PRECACHE=[];'))throw Error('sw.js placeholders not found');
writeFileSync(join(pub,'sw.js'),sw.replace("const VERSION='dev';",`const VERSION='${version}';`).replace('const PRECACHE=[];',`const PRECACHE=${JSON.stringify(precache)};`));
console.log(`service worker ${version}: ${precache.length} files kept offline`);
