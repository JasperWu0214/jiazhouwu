import { mkdir, readdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'public');
// Keep server code, credentials, tests and private originals out of the public site.
const privateFiles = new Set([
  // Historical enquiry summary predates the confirmed outcome.
  'Cambridge_Mark_Scheme_Appeal.docx',
  'basic-algorithm-quiz.png',
  'ielts-listening-5.5-before.jpeg',
  'ielts-listening-7.5-after.jpeg',
  'missing-semester-notes-preview.svg',
  'recommendation-cs-teacher-sample.pdf',
  'recommendation-homeroom-teacher-sample.pdf',
  'screenshot of appeal email.png',
  'screenshot of the Wikipedia statement page.png',
  'screenshot of the mark scheme.png',
  'screenshot of the question.png',
]);
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
let count = 0;
for (const entry of await readdir(root, { withFileTypes: true })) {
  if (!entry.isFile() || privateFiles.has(entry.name)) continue;
  if (!/\.(?:html|css|js|png|jpe?g|gif|webp|svg|ico|pdf|docx|woff2?|mp4|webm)$/i.test(entry.name)) continue;
  await copyFile(path.join(root, entry.name), path.join(output, entry.name));
  count++;
}
console.log(`Built ${count} public files.`);
