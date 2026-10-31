/**
 * Files and folders (owned by the Files and attachments workstream).
 *
 * JSON follows lib/api/v1/attachment.rb and lib/api/v1/folders.rb. Downloads serve
 * real bytes from ../fixtures with the right Content-Type, the way Canvas does:
 * `/files/:id/download?verifier=…` works without a token when the verifier matches,
 * and redirects to a storage URL that honors byte ranges (video players need them).
 *
 * Cases for the viewer's error states:
 *   /api/v1/files/6020  locked until a future date (locked_for_user + lock_explanation)
 *   /api/v1/files/6021  no permission (401 "user not authorized", as Canvas sends it)
 *   /api/v1/files/6099  not found
 *   file 6040           download returns a Canvas login page instead of the file
 *   file 6041           download fails with a server error
 *   file 6042           metadata exists but the download is gone (404)
 */
import { Buffer } from 'node:buffer';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { at, BASE, courseById, user } from '../data.mjs';
import { paginate } from './core.mjs';

const TOKEN = process.env.FAKE_CANVAS_TOKEN ?? 'dev';
const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});
// Canvas answers a permission failure with 401 too, but with this body (render_unauthorized_action).
const unauthorized = () => ({
  status: 401,
  body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] },
});
const authed = (req) => req.headers.authorization === `Bearer ${TOKEN}`;

// --- Folders -----------------------------------------------------------------

const folders = [
  { id: '501', name: 'course files', parent: null, context: ['Course', '201'] },
  { id: '502', name: 'Lectures', parent: '501', context: ['Course', '201'], position: 1 },
  { id: '503', name: 'Labs', parent: '501', context: ['Course', '201'], position: 2 },
  { id: '504', name: 'Readings', parent: '501', context: ['Course', '201'], position: 3 },
  { id: '511', name: 'course files', parent: null, context: ['Course', '225'] },
  { id: '512', name: 'MP3', parent: '511', context: ['Course', '225'] },
  { id: '521', name: 'course files', parent: null, context: ['Course', '110'] },
  { id: '531', name: 'course files', parent: null, context: ['Course', '241'] },
  { id: '541', name: 'course files', parent: null, context: ['Course', '150'] },
  { id: '551', name: 'course files', parent: null, context: ['Course', '101'] },
  { id: '561', name: 'course files', parent: null, context: ['Course', '306'] },
  { id: '601', name: 'my files', parent: null, context: ['User', user.id] },
  { id: '602', name: 'conversation attachments', parent: '601', context: ['User', user.id] },
  { id: '603', name: 'Submissions', parent: '601', context: ['User', user.id], forSubmissions: true },
  { id: '604', name: 'Download test cases', parent: '601', context: ['User', user.id] },
];

const folderById = (id) => folders.find((f) => f.id === String(id));

function fullName(folder) {
  const names = [];
  for (let f = folder; f; f = f.parent ? folderById(f.parent) : null) names.unshift(f.name);
  return names.join('/');
}

// --- Files -------------------------------------------------------------------

/** `fixture` is a file in ../fixtures; `type` is the Content-Type Canvas stored. */
const files = [
  // BIO 201
  {
    id: '6001',
    folder: '501',
    name: 'Syllabus.pdf',
    fixture: 'syllabus.pdf',
    type: 'application/pdf',
    canvadoc: true,
    created: at(-60, 9),
    updated: at(-58, 14),
  },
  {
    id: '6002',
    folder: '502',
    name: 'Week 3 lecture clip.mp4',
    fixture: 'lecture-clip.mp4',
    type: 'video/mp4',
    created: at(-12, 11),
    updated: at(-12, 11),
  },
  {
    id: '6003',
    folder: '502',
    name: 'Cell diagram.png',
    fixture: 'cell-diagram.png',
    type: 'image/png',
    created: at(-20, 10),
    updated: at(-20, 10),
  },
  {
    id: '6008',
    folder: '502',
    name: 'Cell cycle.gif',
    fixture: 'cell-cycle.gif',
    type: 'image/gif',
    created: at(-18, 10),
    updated: at(-18, 10),
  },
  {
    id: '6009',
    folder: '502',
    name: 'Office hours recording.m4a',
    fixture: 'office-hours.m4a',
    type: 'audio/mp4',
    created: at(-5, 16),
    updated: at(-5, 16),
  },
  {
    id: '6004',
    folder: '503',
    name: 'Osmosis lab photo.jpg',
    fixture: 'lab-photo.jpg',
    type: 'image/jpeg',
    created: at(-9, 15),
    updated: at(-9, 15),
  },
  {
    id: '6005',
    folder: '503',
    name: 'Lab notes.txt',
    fixture: 'lab-notes.txt',
    type: 'text/plain',
    created: at(-9, 16),
    updated: at(-8, 9),
  },
  {
    id: '6006',
    folder: '503',
    name: 'Lab data.csv',
    fixture: 'lab-data.csv',
    type: 'text/csv',
    created: at(-9, 16),
    updated: at(-9, 16),
  },
  {
    id: '6007',
    folder: '503',
    name: 'Osmosis lab handout.html',
    fixture: 'lab-handout.html',
    type: 'text/html',
    created: at(-14, 9),
    updated: at(-14, 9),
  },
  {
    id: '6015',
    folder: '503',
    name: 'Lab report template.pdf',
    fixture: 'syllabus.pdf',
    type: 'application/pdf',
    created: at(-14, 9),
    updated: at(-14, 9),
    lockAt: at(30, 23, 59),
  },
  // Reachable only through links: locked until next week.
  {
    id: '6020',
    folder: '502',
    name: 'Midterm answer key.pdf',
    fixture: 'syllabus.pdf',
    type: 'application/pdf',
    created: at(-3, 9),
    updated: at(-3, 9),
    unlockAt: at(7, 0),
    unlisted: true,
  },
  {
    id: '6021',
    folder: '502',
    name: 'Instructor notes.pdf',
    fixture: 'syllabus.pdf',
    type: 'application/pdf',
    created: at(-3, 9),
    updated: at(-3, 9),
    forbidden: true,
    unlisted: true,
  },
  // CS 225
  {
    id: '6010',
    folder: '511',
    name: 'MP3 README.md',
    fixture: 'mp3-readme.md',
    type: 'text/markdown',
    created: at(-6, 12),
    updated: at(-2, 18),
  },
  {
    id: '6011',
    folder: '512',
    name: 'starter-code.zip',
    fixture: 'starter-code.zip',
    type: 'application/zip',
    created: at(-6, 12),
    updated: at(-6, 12),
  },
  {
    id: '6012',
    folder: '512',
    name: 'hash_table.py',
    fixture: 'hash_table.py',
    type: 'text/x-python',
    created: at(-6, 12),
    updated: at(-6, 12),
  },
  // ENGL 110
  {
    id: '6013',
    folder: '521',
    name: 'Essay 2 guidelines.docx',
    fixture: 'essay-guidelines.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    canvadoc: true,
    created: at(-15, 8),
    updated: at(-10, 8),
  },
  {
    id: '6014',
    folder: '521',
    name: 'Peer review form.docx',
    fixture: 'essay-guidelines.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    created: at(-15, 8),
    updated: at(-15, 8),
  },
  // My Files
  {
    id: '6030',
    folder: '601',
    name: 'Essay 1 final.docx',
    fixture: 'essay-guidelines.docx',
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    created: at(-30, 22),
    updated: at(-30, 22),
  },
  {
    id: '6031',
    folder: '602',
    name: 'Whiteboard photo.jpg',
    fixture: 'lab-photo.jpg',
    type: 'image/jpeg',
    created: at(-4, 13),
    updated: at(-4, 13),
  },
  {
    id: '6032',
    folder: '603',
    name: 'Lab report 2.pdf',
    fixture: 'syllabus.pdf',
    type: 'application/pdf',
    created: at(-11, 23),
    updated: at(-11, 23),
  },
  {
    id: '6033',
    folder: '601',
    name: 'Study schedule.txt',
    fixture: 'lab-notes.txt',
    type: 'text/plain',
    created: at(-2, 20),
    updated: at(-1, 8),
    hidden: true,
  },
  {
    id: '6040',
    folder: '604',
    name: 'Guest lecture slides.pdf',
    fixture: 'syllabus.pdf',
    type: 'application/pdf',
    created: at(-1, 9),
    updated: at(-1, 9),
    loginPage: true,
  },
  {
    id: '6041',
    folder: '604',
    name: 'Reading packet.pdf',
    fixture: 'syllabus.pdf',
    type: 'application/pdf',
    created: at(-1, 9),
    updated: at(-1, 9),
    serverError: true,
  },
  {
    id: '6042',
    folder: '604',
    name: 'Old handout.pdf',
    fixture: 'syllabus.pdf',
    type: 'application/pdf',
    created: at(-1, 9),
    updated: at(-1, 9),
    gone: true,
  },
];

const fileById = (id) => files.find((f) => f.id === String(id));
const uuid = (f) => `fakeuuid${f.id}`;
/** Bytes uploaded to My Files while the server runs. */
const uploadedBytes = new Map();
const readBytes = (f) => (f.upload ? uploadedBytes.get(f.upload) : readFileSync(join(fixtures, f.fixture)));
const sizeOf = (f) =>
  f.upload ? uploadedBytes.get(f.upload).length : statSync(join(fixtures, f.fixture)).size;
const contextOf = (f) => folderById(f.folder).context;
const isImage = (f) => f.type.startsWith('image/');
const mimeClass = (f) => {
  if (f.type === 'application/pdf') return 'pdf';
  if (f.type.includes('wordprocessingml')) return 'doc';
  if (f.type === 'application/zip') return 'zip';
  if (f.type === 'text/html') return 'html';
  const top = f.type.split('/')[0];
  return ['image', 'video', 'audio', 'text'].includes(top) ? top : 'file';
};

const lockDate = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});

/** Attachment JSON (lib/api/v1/attachment.rb). `locked_for_user` blanks the URLs, as Canvas does. */
function fileJson(f, { includes = new Set(), show = false } = {}) {
  const now = Date.now();
  const lockedForUser =
    (f.unlockAt && now < Date.parse(f.unlockAt)) || (f.lockAt && now > Date.parse(f.lockAt)) || false;
  const [contextType, contextId] = contextOf(f);
  const json = {
    id: f.id,
    uuid: uuid(f),
    folder_id: f.folder,
    display_name: f.name,
    filename: f.name.replace(/\s+/g, '+'),
    upload_status: 'success',
    'content-type': f.type,
    url: lockedForUser ? '' : `${BASE}/files/${f.id}/download?download_frd=1&verifier=${uuid(f)}`,
    size: sizeOf(f),
    created_at: f.created,
    updated_at: f.updated,
    unlock_at: f.unlockAt ?? null,
    locked: false,
    hidden: f.hidden ?? false,
    lock_at: f.lockAt ?? null,
    hidden_for_user: false,
    thumbnail_url: isImage(f) && !lockedForUser ? `${BASE}/images/thumbnails/${f.id}/${uuid(f)}` : null,
    modified_at: f.updated,
    mime_class: mimeClass(f),
    media_entry_id: f.type.startsWith('video/') || f.type.startsWith('audio/') ? `m-fake${f.id}` : null,
    category: 'uncategorized',
    locked_for_user: lockedForUser,
  };
  if (lockedForUser) {
    json.lock_info = {
      asset_string: `attachment_${f.id}`,
      unlock_at: f.unlockAt ?? undefined,
      lock_at: f.lockAt ?? undefined,
    };
    json.lock_explanation = f.unlockAt
      ? `This file is locked until ${lockDate.format(new Date(f.unlockAt))}.`
      : `This file was locked ${lockDate.format(new Date(f.lockAt))}.`;
  }
  if (includes.has('context_asset_string'))
    json.context_asset_string = `${contextType.toLowerCase()}_${contextId}`;
  if (includes.has('user'))
    json.user = { id: 't201', display_name: courseById(contextId)?.teacher ?? user.name };
  // api_show adds a DocViewer session for unlocked files when Canvadocs is enabled.
  if (show && f.canvadoc && !lockedForUser) json.canvadoc_session_url = `${BASE}/fake/canvadoc/${f.id}`;
  if (includes.has('preview_url'))
    json.preview_url = f.canvadoc && !lockedForUser ? `${BASE}/fake/canvadoc/${f.id}` : null;
  return json;
}

/** Folder JSON (lib/api/v1/folders.rb). */
function folderJson(folder) {
  const [contextType, contextId] = folder.context;
  return {
    id: folder.id,
    name: folder.name,
    full_name: fullName(folder),
    position: folder.position ?? null,
    parent_folder_id: folder.parent,
    context_type: contextType,
    context_id: contextId,
    unlock_at: null,
    lock_at: null,
    created_at: at(-90, 9),
    updated_at: at(-10, 9),
    locked: false,
    folders_url: `${BASE}/api/v1/folders/${folder.id}/folders`,
    files_url: `${BASE}/api/v1/folders/${folder.id}/files`,
    files_count: files.filter((f) => f.folder === folder.id && !f.unlisted).length,
    folders_count: folders.filter((f) => f.parent === folder.id).length,
    hidden: false,
    locked_for_user: false,
    hidden_for_user: false,
    for_submissions: folder.forSubmissions ?? false,
    can_upload: contextType === 'User',
  };
}

const sorters = {
  name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
  size: (a, b) => sizeOf(a) - sizeOf(b),
  created_at: (a, b) => Date.parse(a.created) - Date.parse(b.created),
  updated_at: (a, b) => Date.parse(a.updated) - Date.parse(b.updated),
  content_type: (a, b) => a.type.localeCompare(b.type),
};

/** search_term, sort, and order the way files_controller#api_index reads them. */
function listFiles(scope, query, url) {
  const term = query.search_term?.trim();
  if (term !== undefined && term.length < 2)
    return {
      status: 400,
      body: { errors: [{ message: 'search_term of 2 or more characters is required' }] },
    };
  let items = scope.filter((f) => !f.unlisted);
  if (term) items = items.filter((f) => f.name.toLowerCase().includes(term.toLowerCase()));
  items = [...items].sort(sorters[query.sort] ?? sorters.name);
  if (query.order === 'desc') items.reverse();
  const includes = new Set(query.include ?? []);
  return paginate(
    items.map((f) => fileJson(f, { includes })),
    query,
    url,
  );
}

function listFolders(scope, query, url) {
  const term = query.search_term?.trim();
  if (term !== undefined && term.length < 2)
    return {
      status: 400,
      body: { errors: [{ message: 'search_term of 2 or more characters is required' }] },
    };
  let items = scope;
  if (term) items = items.filter((f) => f.name.toLowerCase().includes(term.toLowerCase()));
  items = [...items].sort(sorters.name);
  return paginate(items.map(folderJson), query, url);
}

const rootFolder = (type, id) =>
  folders.find((f) => !f.parent && f.context[0] === type && f.context[1] === String(id));
const inContext = (type, id) => (f) => {
  const [t, i] = contextOf(f);
  return t === type && i === String(id);
};
const userId = (id) => (id === 'self' ? user.id : id);

/** `folders/by_path/*` (folders_controller#resolve_path): every folder from the root down. */
function byPath(type, id, names) {
  let folder = rootFolder(type, id);
  if (!folder) return notFound();
  const chain = [folder];
  for (const name of names) {
    folder = folders.find((f) => f.parent === folder.id && f.name.toLowerCase() === name.toLowerCase());
    if (!folder) return notFound();
    chain.push(folder);
  }
  return chain.map(folderJson);
}
const pathParts = (params) => [params.a, params.b, params.c].filter(Boolean);

function showFile({ params, query }) {
  const f = fileById(params.fileId);
  if (!f) return notFound();
  if (params.courseId && !inContext('Course', params.courseId)(f)) return notFound();
  if (f.forbidden) return unauthorized();
  return fileJson(f, { includes: new Set(query.include ?? []), show: true });
}

// --- Downloads -----------------------------------------------------------------

const loginPage = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Log In to Canvas</title></head>
<body><form action="/login/canvas" method="post"><h1>Log In</h1>
<label>Email <input name="pseudonym_session[unique_id]"></label>
<label>Password <input type="password" name="pseudonym_session[password]"></label>
<button>Log In</button></form></body></html>`;

function download({ params, query, req }) {
  const f = fileById(params.fileId);
  if (!f) return notFound();
  // Canvas sends signed-out browsers to the login page, which arrives as a 200 HTML response.
  if (f.loginPage || f.forbidden)
    return { status: 200, body: loginPage, headers: { 'Content-Type': 'text/html; charset=utf-8' } };
  if (!authed(req) && query.verifier !== uuid(f))
    return { status: 200, body: loginPage, headers: { 'Content-Type': 'text/html; charset=utf-8' } };
  if (f.gone) return notFound();
  if (f.serverError)
    return { status: 500, body: { errors: [{ message: 'An error occurred while fetching this file.' }] } };
  const now = Date.now();
  if ((f.unlockAt && now < Date.parse(f.unlockAt)) || (f.lockAt && now > Date.parse(f.lockAt)))
    return unauthorized();
  // Real Canvas redirects to file storage (inst-fs or S3) with a signed URL.
  return {
    status: 302,
    body: '',
    headers: { Location: `${BASE}/fake/storage/${f.id}/${encodeURIComponent(f.name)}?sig=${uuid(f)}` },
  };
}

/** Signed storage URL: no token needed, byte ranges supported. */
function storage({ params, query, req }) {
  const f = fileById(params.fileId);
  if (!f || query.sig !== uuid(f))
    return { status: 403, body: 'Request has expired', headers: { 'Content-Type': 'text/plain' } };
  const bytes = readBytes(f);
  const disposition = `${query.inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(f.name)}`;
  const headers = {
    'Content-Type': f.type,
    'Content-Disposition': disposition,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  };
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
  if (range && (range[1] || range[2])) {
    const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
    const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    if (start >= bytes.length || start > end)
      return { status: 416, body: '', headers: { 'Content-Range': `bytes */${bytes.length}` } };
    const chunk = bytes.subarray(start, end + 1);
    return {
      status: 206,
      body: chunk,
      headers: {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${bytes.length}`,
        'Content-Length': String(chunk.length),
      },
    };
  }
  return { status: 200, body: bytes, headers: { ...headers, 'Content-Length': String(bytes.length) } };
}

function thumbnail({ params }) {
  const f = fileById(params.fileId);
  if (!f || !isImage(f) || params.uuid !== uuid(f)) return notFound();
  return { status: 200, body: readBytes(f), headers: { 'Content-Type': f.type } };
}

/*
 * Canvadocs (DocViewer), the way Canvas uses it: `canvadoc_session_url`
 * redirects to the session's viewer at `/1/sessions/:id/view`. The session URL
 * answers JSON metadata whose `urls.pdf_download` is the PDF rendition, which
 * the official apps (canvas-ios DocViewerSession) and Easel's Print use.
 */
const sessionFor = (fileId) => `fakesession${fileId}`;
const fileForSession = (sessionId) => fileById(String(sessionId).replace(/^fakesession/, ''));

function canvadocRedirect({ params }) {
  const f = fileById(params.fileId);
  if (!f?.canvadoc) return notFound();
  return {
    status: 302,
    body: '',
    headers: { Location: `${BASE}/fake/canvadocs/1/sessions/${sessionFor(f.id)}/view?theme=light` },
  };
}

function canvadocMetadata({ params }) {
  const f = fileForSession(params.sessionId);
  if (!f?.canvadoc) return notFound();
  return {
    annotations: { enabled: false },
    urls: { pdf_download: `/fake/canvadocs/1/sessions/${params.sessionId}/download` },
  };
}

/** A one-page PDF with the given lines, for documents that have no PDF of their own. */
function textPdf(title, lines) {
  const esc = (t) => t.replace(/[\\()]/g, (c) => `\\${c}`);
  const text = [`BT /F1 20 Tf 72 720 Td (${esc(title)}) Tj ET`]
    .concat(lines.map((line, i) => `BT /F1 12 Tf 72 ${684 - i * 18} Td (${esc(line)}) Tj ET`))
    .join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out);
}

function canvadocPdf({ params }) {
  const f = fileForSession(params.sessionId);
  if (!f?.canvadoc) return notFound();
  const bytes =
    f.type === 'application/pdf'
      ? readBytes(f)
      : textPdf(f.name, [
          'Choose a public argument published in the last year and analyze',
          'how its author appeals to a specific audience.',
          '',
          '1,500 to 2,000 words. MLA format. At least four sources.',
        ]);
  return {
    status: 200,
    body: bytes,
    headers: { 'Content-Type': 'application/pdf', 'Content-Length': String(bytes.length) },
  };
}

/** Stands in for the Canvadocs viewer page. */
function canvadoc({ params }) {
  const f = fileForSession(params.sessionId);
  if (!f?.canvadoc) return notFound();
  const pages =
    f.type === 'application/pdf'
      ? [
          '<h1>Cell Biology Syllabus</h1><p>BIO 201, Fall 2026. Dr. Amara Osei.</p><p>Lectures: Monday and Wednesday, 10:00 to 11:15.</p>',
          '<h1>Grading</h1><p>Lab reports 30%. Quizzes 20%. Midterm 20%. Final 25%.</p>',
        ]
      : [
          '<h1>Essay 2 Guidelines</h1><p>ENGL 110: Rhetoric &amp; Composition</p><h2>Prompt</h2><p>Choose a public argument published in the last year and analyze how its author appeals to a specific audience.</p>',
          '<h2>Requirements</h2><ul><li>1,500 to 2,000 words</li><li>MLA format</li><li>At least four sources</li></ul><h2>Timeline</h2><p>Draft in week 9, peer review in week 10, final in week 11.</p>',
        ];
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${f.name} - DocViewer</title>
<style>body{margin:0;background:#525659;font-family:Georgia,serif}.bar{position:sticky;top:0;background:#323639;color:#eee;font:13px -apple-system,system-ui,sans-serif;padding:10px 14px}.page{background:#fff;color:#222;margin:16px auto;width:calc(100% - 32px);max-width:612px;min-height:70vh;padding:40px 32px;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.4)}h1{font-size:24px}</style></head>
<body><div class="bar">DocViewer (fake) · ${f.name}</div>${pages.map((p) => `<div class="page">${p}</div>`).join('')}</body></html>`;
  return { status: 200, body: html, headers: { 'Content-Type': 'text/html; charset=utf-8' } };
}

// --- Uploads (My Files) ------------------------------------------------------------

let nextUploadId = 7000;
const uploads = new Map();

/** Step 1 of Canvas's upload flow: POST /api/v1/users/self/files returns where to send the bytes. */
function uploadPreflight({ body, query }) {
  const params = { ...(query ?? {}), ...(body ?? {}) };
  if (!params.name) return { status: 400, body: { errors: [{ message: 'name is required' }] } };
  const token = `up${nextUploadId++}`;
  uploads.set(token, {
    name: params.name,
    type: params.content_type || 'application/octet-stream',
    folder: params.parent_folder_id || '601',
  });
  return {
    upload_url: `${BASE}/fake/upload/${token}`,
    upload_params: { filename: params.name, content_type: params.content_type || 'application/octet-stream' },
    file_param: 'file',
  };
}

/** Step 2: the bytes. Real Canvas stores them in inst-fs and answers with the file JSON. */
function uploadBytes({ params, body, req }) {
  const pending = uploads.get(params.token);
  if (!pending) return notFound();
  uploads.delete(params.token);
  const raw = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
  // Pull the file part out of the multipart body.
  const boundary = /boundary=([^;]+)/.exec(req.headers['content-type'] ?? '')?.[1];
  let bytes = raw;
  if (boundary) {
    const text = raw.toString('latin1');
    const parts = text.split(`--${boundary}`);
    const part = parts.find((p) => /name="file"/.test(p));
    if (part) {
      const start = part.indexOf('\r\n\r\n') + 4;
      bytes = Buffer.from(part.slice(start, part.lastIndexOf('\r\n')), 'latin1');
    }
  }
  const id = String(nextUploadId++);
  const name = `upload-${id}`;
  uploadedBytes.set(name, bytes);
  const f = {
    id,
    folder: pending.folder,
    name: pending.name,
    fixture: null,
    upload: name,
    type: pending.type,
    created: new Date().toISOString(),
    updated: new Date().toISOString(),
  };
  files.push(f);
  return { status: 201, body: fileJson(f, { show: true }) };
}

export const routes = [
  // Folders
  {
    path: '/api/v1/courses/:courseId/folders/root',
    handler: ({ params }) => {
      const folder = rootFolder('Course', params.courseId);
      return folder ? folderJson(folder) : notFound();
    },
  },
  {
    path: '/api/v1/users/:userId/folders/root',
    handler: ({ params }) => {
      const folder = rootFolder('User', userId(params.userId));
      return folder ? folderJson(folder) : notFound();
    },
  },
  {
    path: '/api/v1/groups/:groupId/folders/root',
    handler: ({ params }) => {
      const folder = rootFolder('Group', params.groupId);
      return folder ? folderJson(folder) : notFound();
    },
  },
  ...['/:a', '/:a/:b', '/:a/:b/:c'].map((tail) => ({
    path: `/api/v1/courses/:courseId/folders/by_path${tail}`,
    handler: ({ params }) => byPath('Course', params.courseId, pathParts(params)),
  })),
  {
    path: '/api/v1/courses/:courseId/folders',
    handler: ({ params, query, url }) =>
      listFolders(
        folders.filter((f) => f.context[0] === 'Course' && f.context[1] === params.courseId && f.parent),
        query,
        url,
      ),
  },
  {
    path: '/api/v1/users/:userId/folders',
    handler: ({ params, query, url }) =>
      listFolders(
        folders.filter((f) => f.context[0] === 'User' && f.context[1] === userId(params.userId) && f.parent),
        query,
        url,
      ),
  },
  {
    path: '/api/v1/folders/:folderId',
    handler: ({ params }) => {
      const folder = folderById(params.folderId);
      return folder ? folderJson(folder) : notFound();
    },
  },
  {
    path: '/api/v1/folders/:folderId/folders',
    handler: ({ params, query, url }) =>
      folderById(params.folderId)
        ? listFolders(
            folders.filter((f) => f.parent === params.folderId),
            query,
            url,
          )
        : notFound(),
  },
  {
    path: '/api/v1/folders/:folderId/files',
    handler: ({ params, query, url }) =>
      folderById(params.folderId)
        ? listFiles(
            files.filter((f) => f.folder === params.folderId),
            query,
            url,
          )
        : notFound(),
  },
  // Context-wide file lists (search)
  {
    path: '/api/v1/courses/:courseId/files',
    handler: ({ params, query, url }) =>
      courseById(params.courseId)
        ? listFiles(files.filter(inContext('Course', params.courseId)), query, url)
        : notFound(),
  },
  {
    path: '/api/v1/users/:userId/files',
    method: 'GET',
    handler: ({ params, query, url }) =>
      listFiles(files.filter(inContext('User', userId(params.userId))), query, url),
  },
  { path: '/api/v1/users/:userId/files', method: 'POST', handler: uploadPreflight },
  { path: '/api/v1/files/:fileId', handler: showFile },
  { path: '/api/v1/courses/:courseId/files/:fileId', handler: showFile },
  { path: '/api/v1/users/:userId/files/quota', handler: () => ({ quota: 524288000, quota_used: 2400000 }) },

  // Bytes. Public: the verifier, a storage signature, or nothing at all (thumbnails) authorizes them.
  { path: '/files/:fileId/download', public: true, handler: download },
  { path: '/files/:fileId/download', method: 'HEAD', public: true, handler: download },
  { path: '/courses/:courseId/files/:fileId/download', public: true, handler: download },
  { path: '/fake/storage/:fileId/:name', public: true, handler: storage },
  { path: '/fake/storage/:fileId/:name', method: 'HEAD', public: true, handler: storage },
  { path: '/images/thumbnails/:fileId/:uuid', public: true, handler: thumbnail },
  { path: '/fake/canvadoc/:fileId', public: true, handler: canvadocRedirect },
  { path: '/fake/canvadocs/1/sessions/:sessionId/view', public: true, handler: canvadoc },
  { path: '/fake/canvadocs/1/sessions/:sessionId/download', public: true, handler: canvadocPdf },
  { path: '/fake/canvadocs/1/sessions/:sessionId', public: true, handler: canvadocMetadata },
  { path: '/fake/upload/:token', method: 'POST', public: true, handler: uploadBytes },
];
