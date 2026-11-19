import {copyFile,mkdir,readFile,writeFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});
for (const asset of ['app.mjs','engine.mjs','style.css'])
  await copyFile(asset,'dist/'+asset);
const html = await readFile('index.html','utf8');
await writeFile('dist/index.html',html.replace('<head>','<head>\n<meta name="aviceena-hosted-chat" content="cloudflare">'));
