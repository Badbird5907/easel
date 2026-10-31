/**
 * Submitting and feedback (owned by the Submissions workstream): file upload
 * preflights for submissions and submission comments, the upload target and its
 * storage, creating attempts, adding comments, and the
 * DocViewer page that shows instructor annotations.
 *
 * Shapes follow canvas-lms: app/controllers/submissions_controller.rb#create,
 * submissions_api_controller.rb#update and #create_file,
 * submission_comments_api_controller.rb#create_file, services_api_controller.rb,
 * lib/api/v1/submission.rb, submission_comment.rb, attachment.rb, lib/api.rb.
 *
 * Assignments and the submission JSON builders live in course-content.mjs, which
 * registers them on the shared store (`store.course`) each time it loads. Route
 * files reload as separate module instances, so everything mutable is on globalThis
 * and survives reloads until the server restarts.
 *
 * Flow the app uses:
 *   POST /api/v1/courses/:c/assignments/:a/submissions/self/files       -> upload_url
 *   POST <upload_url> (multipart, field "file")                          -> 201 attachment JSON
 *   POST /api/v1/courses/:c/assignments/:a/submissions                   -> 201 submission JSON
 *   POST /api/v1/courses/:c/assignments/:a/submissions/self/comments/files -> upload_url
 *   PUT  /api/v1/courses/:c/assignments/:a/submissions/self (comment[...]) -> submission JSON
 *
 * `POST /fake/submissions/reset` drops what was turned in since the server started.
 *
 * Kaltura is off (`/api/v1/services/kaltura` says `enabled: false`), so recordings go up as
 * comment attachments. `comment[media_comment_id]` is still stored and serialized as a
 * media comment; conversations.mjs serves `/users/:id/media_download` for the fixture media
 * IDs `m-fake6009` (audio) and `m-fake6002` (video).
 */
import { Buffer } from 'node:buffer';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { at, BASE, user } from '../data.mjs';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

const store = (globalThis.__easelFakeSubmissions ??= {
  attempts: {},
  comments: {},
  files: new Map(),
  uploads: new Map(),
  resubmitted: {},
  nextId: 8000,
});

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// The graded file on assignment 9123 (course-content.mjs) lives in this storage.
function seed() {
  if (!store.files.has('7990'))
    store.files.set('7990', {
      id: '7990',
      name: 'Annotated bibliography.docx',
      type: DOCX,
      bytes: readFileSync(join(fixtures, 'essay-guidelines.docx')),
      created: at(-16, 21, 30),
    });
}
seed();

/** `POST /fake/submissions/reset`: forget everything turned in or commented since the server started. */
function reset() {
  Object.assign(store, { attempts: {}, comments: {}, files: new Map(), uploads: new Map(), resubmitted: {} });
  seed();
  return { status: 200, body: { ok: true } };
}

// --- Responses ---------------------------------------------------------------------

const notFound = () => ({
  status: 404,
  body: { errors: [{ message: 'The specified resource does not exist.' }] },
});
// render_unauthorized_action
const unauthorized = () => ({
  status: 401,
  body: { status: 'unauthorized', errors: [{ message: 'user not authorized to perform that action' }] },
});
const badRequest = (body) => ({ status: 400, body });
/** ActiveModel errors as Canvas renders them for `render json: record.errors`. */
const modelErrors = (attribute, message, type = message) =>
  badRequest({ errors: { [attribute]: [{ attribute, type, message }] } });

const isSelf = (userId) => userId === 'self' || userId === user.id;
const course = () => store.course;
const find = (params) => course()?.assignmentById(params.courseId, params.assignmentId);
const ids = (value) =>
  (Array.isArray(value) ? value : value == null ? [] : [value]).map(String).filter(Boolean);
const newId = () => String(store.nextId++);

/**
 * Easel sends JSON (`{ submission: { … } }`). Forms and curl send Rails-style
 * flat keys (`submission[submission_type]`, `submission[file_ids][]`); fold those in.
 */
function nested(body) {
  if (!body || Buffer.isBuffer(body)) return {};
  const out = {};
  for (const [key, value] of Object.entries(body)) {
    const m = /^(\w+)\[(\w+)\](\[\])?$/.exec(key);
    if (!m) {
      out[key] = value;
      continue;
    }
    out[m[1]] ??= {};
    out[m[1]][m[2]] = m[3] ? [...ids(out[m[1]][m[2]]), ...ids(value)] : value;
  }
  return out;
}

/** Byte ranges, the way inst-fs and S3 serve them (video and audio players need them). */
function serveBytes(bytes, type, name, req, { inline = true } = {}) {
  const headers = {
    'Content-Type': type,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${name.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
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

// --- Step 1: preflight --------------------------------------------------------------

const extensionOf = (name) => (/\.([a-z0-9]+)$/i.exec(name ?? '')?.[1] ?? '').toLowerCase();
const extensionsByType = {
  'application/pdf': 'pdf',
  [DOCX]: 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
  'audio/mp4': 'm4a',
  'video/mp4': 'mp4',
};

/**
 * `POST …/submissions/:user_id/files` (SubmissionsApiController#create_file) and
 * `…/comments/files` (SubmissionCommentsApiController#create_file). Canvas answers with
 * where to send the bytes. Submission files must match `allowed_extensions`.
 */
function preflight(kind) {
  return ({ params, body, query }) => {
    const a = find(params);
    if (!a || !isSelf(params.userId)) return notFound();
    const input = { ...(query ?? {}), ...nested(body) };
    if (!input.name) return badRequest({ errors: [{ message: 'name is required' }] });
    const type = input.content_type || 'application/octet-stream';
    if (kind === 'submission') {
      // authorized_action(:submit): only online_upload assignments, and not while locked.
      if (!a.types.includes('online_upload') || course().lockFor(a).locked_for_user) return unauthorized();
      if (a.extensions?.length) {
        const extension = extensionOf(input.name) || extensionsByType[type];
        if (!extension) return badRequest({ errors: [{ message: 'unable to find extension' }] });
        if (!a.extensions.includes(extension))
          return badRequest({ errors: [{ message: 'filetype not allowed' }] });
      }
    }
    const token = `sub${newId()}`;
    store.uploads.set(token, { name: String(input.name), type, kind, assignment: a.id });
    return {
      upload_url: `${BASE}/fake/submission-upload/${token}`,
      upload_params: { filename: String(input.name), content_type: type },
      file_param: 'file',
      progress: null,
    };
  };
}

// --- Step 2: bytes ------------------------------------------------------------------

/** Pulls the `file` part out of a multipart body. */
function filePart(raw, contentType) {
  const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType ?? '');
  const marker = boundary?.[1] ?? boundary?.[2];
  if (!marker) return raw;
  const text = raw.toString('latin1');
  const part = text.split(`--${marker}`).find((p) => /name="file"/.test(p));
  if (!part) return Buffer.alloc(0);
  const start = part.indexOf('\r\n\r\n') + 4;
  return Buffer.from(part.slice(start, part.lastIndexOf('\r\n')), 'latin1');
}

/** Canvas's upload target (inst-fs) stores the file and answers 201 with the attachment JSON. */
async function uploadBytes({ params, body, req }) {
  const pending = store.uploads.get(params.token);
  if (!pending) return notFound();
  store.uploads.delete(params.token);
  const bytes = filePart(Buffer.isBuffer(body) ? body : Buffer.alloc(0), req.headers['content-type']);
  // A beat of server time so progress and the "Uploading" state are visible.
  await new Promise((resolve) => setTimeout(resolve, Math.min(800, 300 + bytes.length / 4000)));
  const id = newId();
  store.files.set(id, {
    id,
    name: pending.name,
    type: pending.type,
    bytes,
    created: new Date().toISOString(),
  });
  return { status: 201, body: course().attachmentJson(id) };
}

/** Signed storage URL for uploaded files: no token, byte ranges. `thumbnail=1` serves images as-is. */
function storage({ params, query, req }) {
  const f = store.files.get(params.fileId);
  if (!f || query.sig !== `fakeuuid${f.id}`)
    return { status: 403, body: 'Request has expired', headers: { 'Content-Type': 'text/plain' } };
  return serveBytes(f.bytes, f.type, f.name, req, { inline: !!query.thumbnail || !query.download_frd });
}

// --- Step 3: submit -----------------------------------------------------------------

// SubmissionsController::API_SUBMISSION_TYPES
const API_SUBMISSION_TYPES = {
  online_text_entry: ['body'],
  online_url: ['url'],
  online_upload: ['file_ids'],
  media_recording: ['media_comment_id', 'media_comment_type'],
  basic_lti_launch: ['url'],
  student_annotation: ['annotatable_attachment_id'],
};

// Assignment#accepts_submission_type?: tool links count for any online type.
const accepts = (a, type) =>
  type === 'basic_lti_launch' ? a.types.some((t) => /online|external_tool/.test(t)) : a.types.includes(type);

/** process_incoming_html_content, roughly: no scripts, no inline handlers, no javascript: links. */
const sanitize = (html) =>
  String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/(href|src)\s*=\s*(["'])\s*javascript:[^"']*\2/gi, '$1="#"');

/** `POST /api/v1/courses/:course_id/assignments/:assignment_id/submissions` (SubmissionsController#create). */
function submit({ params, body }) {
  const a = find(params);
  if (!a) return notFound();
  const c = course();
  const input = nested(body);
  const sub = input.submission ?? {};
  const type = sub.submission_type;

  // authorized_action(@assignment, @submission_user, :submit) fails while locked.
  if (c.lockFor(a).locked_for_user) return unauthorized();
  if (!API_SUBMISSION_TYPES[type] || !accepts(a, type))
    return badRequest({ message: 'Invalid submission[submission_type] given' });
  const required = API_SUBMISSION_TYPES[type];
  if (required.some((key) => sub[key] === undefined || sub[key] === null))
    return badRequest({
      message: `Invalid parameters for submission_type ${type}. Required: ${required.map((p) => `submission[${p}]`).join(', ')}`,
    });
  // Canvas redirects back to the assignment with a flash here; an API client sees a 400.
  if (type === 'online_text_entry' && !String(sub.body).replace(/<[^>]*>|&nbsp;|\s/g, ''))
    return badRequest({ message: 'Text entry submission cannot be empty' });

  const attempts = c.attemptsOf(a);
  const allowed = a.attempts ?? -1;
  if (allowed > 0 && attempts.length >= allowed)
    return modelErrors(
      'attempt',
      'you have reached the maximum number of allowed attempts for this assignment',
    );

  const att = { type };
  if (type === 'online_text_entry') att.body = sanitize(sub.body);
  if (type === 'online_url' || type === 'basic_lti_launch') {
    let url = String(sub.url).trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = `http://${url}`;
    if (!/^https?:\/\/[^\s/]+\.[^\s]+|^https?:\/\/localhost/i.test(url))
      return modelErrors('url', 'is not a valid URL', 'invalid');
    att.url = url;
  }
  if (type === 'online_upload') {
    // lookup_existing_attachments keeps the IDs it finds; none at all is an error.
    const found = ids(sub.file_ids).filter((id) => store.files.has(id));
    if (!found.length) return badRequest({ message: 'No valid file ids given' });
    att.files = found;
  }
  if (type === 'media_recording') {
    const mediaType = sub.media_comment_type === 'audio' ? 'audio' : 'video';
    const entry = kaltura().entries.get(String(sub.media_comment_id));
    att.media = { id: String(sub.media_comment_id), type: mediaType, title: entry?.name ?? null };
  }
  if (type === 'basic_lti_launch' && sub.resource_link_lookup_uuid) att.lookup = String(sub.resource_link_lookup_uuid);
  if (type === 'student_annotation') {
    if (String(sub.annotatable_attachment_id) !== a.annotatable)
      return badRequest({ message: 'annotatable_attachment_id does not match the assignment' });
    att.annotatable = a.annotatable;
  }

  const now = new Date();
  att.attempt = (attempts.at(-1)?.attempt ?? 0) + 1;
  // The draft's annotations become this attempt's (CanvadocsAnnotationContext per attempt).
  if (type === 'student_annotation') {
    const draft = docviewer().annotations.get(`draft-${a.id}`) ?? [];
    docviewer().annotations.set(`attempt-${a.id}-${att.attempt}`, [...draft]);
  }
  att.submitted = now.toISOString();
  att.late = !!a.due && now > new Date(a.due);
  (store.attempts[a.id] ??= []).push(att);
  // Submission.after_save :delete_submission_drafts!, if: :saved_change_to_attempt?
  const drafts = globalThis.__easelFakeSubmissionDrafts?.drafts;
  if (drafts) for (const key of Object.keys(drafts)) if (key.startsWith(`s${a.id}:`)) delete drafts[key];
  if (c.isGraded(a)) store.resubmitted[a.id] = true;

  const text = input.comment?.text_comment ?? sub.comment;
  if (text && String(text).trim())
    (store.comments[a.id] ??= []).push({
      id: `sc${newId()}`,
      author: 'self',
      at: att.submitted,
      attempt: att.attempt,
      text: String(text).trim(),
    });

  return {
    status: 201,
    body: c.submissionJson(a, new Set(['submission_comments'])),
    headers: { Location: `${BASE}/api/v1/courses/${a.course}/assignments/${a.id}/submissions/${user.id}` },
  };
}

// --- Comments -----------------------------------------------------------------------

/** `PUT …/submissions/:user_id` with `comment[…]` (SubmissionsApiController#update). */
function update({ params, body, query }) {
  const a = find(params);
  if (!a || !isSelf(params.userId)) return notFound();
  const c = course();
  const input = nested(body);
  const comment = input.comment;
  if (comment && typeof comment === 'object') {
    const text = String(comment.text_comment ?? '').trim();
    const fileIds = ids(comment.file_ids);
    // Attachment#grants_right?(:attach_to_submission_comment): only the student's own uploads.
    if (fileIds.some((id) => !store.files.has(id))) return unauthorized();
    const mediaId = comment.media_comment_id ? String(comment.media_comment_id) : null;
    if (!text && !fileIds.length && !mediaId) return modelErrors('comment', "can't be blank", 'blank');
    const attempts = c.attemptsOf(a);
    (store.comments[a.id] ??= []).push({
      id: `sc${newId()}`,
      author: 'self',
      at: new Date().toISOString(),
      attempt: comment.attempt ? Number(comment.attempt) : (attempts.at(-1)?.attempt ?? null),
      text,
      ...(fileIds.length && { files: fileIds }),
      ...(mediaId && {
        media: { id: mediaId, type: comment.media_comment_type === 'audio' ? 'audio' : 'video' },
      }),
    });
  }
  const includes = new Set(['submission_comments', ...ids(query?.include)]);
  return c.submissionJson(a, includes);
}

// --- DocViewer with instructor annotations -------------------------------------------

const annotatedPages = {
  6032: {
    title: 'Lab report 2.pdf',
    pages: [
      `<h1>Agar Cube Diffusion</h1><p>BIO 201 Lab Report, Evan Student</p>
       <h2>Hypothesis</h2><p><mark data-note="1">Smaller cubes will turn fully pink first because they have a larger surface area to volume ratio.</mark></p>
       <h2>Method</h2><p>Three agar cubes (1 cm, 2 cm, 3 cm) soaked in 0.1 M NaOH. Time to full color change recorded every minute.</p>`,
      `<h2>Results</h2><table><tr><th>Cube</th><th>SA:V</th><th>Minutes</th></tr><tr><td>1 cm</td><td>6.0</td><td>4</td></tr><tr><td>2 cm</td><td>3.0</td><td>11</td></tr><tr><td>3 cm</td><td>2.0</td><td>23</td></tr></table>
       <h2>Discussion</h2><p>Diffusion time grew quickly with cube size. <mark data-note="2">Cells stay small for the same reason.</mark></p>`,
    ],
    notes: {
      1: 'Good, testable hypothesis.',
      2: 'Say why: diffusion distance to the center grows faster than the surface does.',
    },
  },
};

/** Stands in for DocViewer (Canvadocs) opened from a submission attachment's `preview_url`. */
function annotated({ params }) {
  const known = annotatedPages[params.fileId];
  const uploaded = store.files.get(params.fileId);
  if (!known && !uploaded) return notFound();
  const title = known?.title ?? uploaded.name;
  const pages = known?.pages ?? [`<h1>${uploaded.name}</h1><p>No annotations on this document yet.</p>`];
  const notes = known?.notes ?? {};
  const noteHtml = (n) => `<aside class="note"><b>Dr. Amara Osei</b><span>${notes[n]}</span></aside>`;
  const body = pages
    .map((p) => {
      const used = [...p.matchAll(/data-note="(\d+)"/g)].map((m) => m[1]);
      return `<div class="page">${p}${used.map(noteHtml).join('')}</div>`;
    })
    .join('');
  const count = Object.keys(notes).length;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} - DocViewer</title>
<style>body{margin:0;background:#525659;font-family:Georgia,serif}.bar{position:sticky;top:0;z-index:1;background:#323639;color:#eee;font:13px -apple-system,system-ui,sans-serif;padding:10px 14px}.page{position:relative;background:#fff;color:#222;margin:16px auto;width:calc(100% - 32px);max-width:612px;min-height:60vh;padding:40px 32px;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.4)}h1{font-size:24px}table{border-collapse:collapse}td,th{border:1px solid #999;padding:4px 8px}mark{background:#ffe066;padding:0 2px}.note{margin-top:16px;border-left:4px solid #d9480f;background:#fff4e6;padding:8px 12px;font:14px -apple-system,system-ui,sans-serif;display:flex;flex-direction:column;gap:2px}</style></head>
<body><div class="bar">DocViewer (fake) · ${title} · ${count} ${count === 1 ? 'annotation' : 'annotations'}</div>${body}</body></html>`;
  return { status: 200, body: html, headers: { 'Content-Type': 'text/html; charset=utf-8' } };
}

// --- Media recordings through Kaltura (ASSIGN-6) -----------------------------------------
//
// services_api_controller.rb (show_kaltura_config, start_kaltura_session), the Kaltura v3
// API the official apps call (uploadtoken.add, uploadtoken.upload, media.addFromUploadedFile;
// canvas-ios APIMediaComment.swift), and media_objects_controller.rb#create_media_object.
// `POST /fake/kaltura/off` makes Canvas report no media service, to test the fallback;
// `/fake/kaltura/on` turns it back on.

const kaltura = () =>
  (store.kaltura ??= { enabled: true, tokens: new Map(), entries: new Map(), nextEntry: 1 });
const docviewer = () => (store.docviewer ??= { annotations: new Map() });

const kalturaXml = (inner) => ({
  status: 200,
  body: `<?xml version="1.0" encoding="utf-8"?><xml><result>${inner}</result><executionTime>0.01</executionTime></xml>`,
  headers: { 'Content-Type': 'text/xml; charset=utf-8' },
});
const kalturaError = (message) =>
  kalturaXml(`<error><code>INVALID_KS</code><message>${message}</message></error>`);

function kalturaApi({ query, body, req }) {
  const form = Buffer.isBuffer(body) ? {} : (body ?? {});
  const ks = query.ks ?? form.ks;
  if (!ks || !String(ks).startsWith('fakeks')) return kalturaError('Invalid KS');
  const k = kaltura();
  if (query.service === 'uploadtoken' && query.action === 'add') {
    const id = `0_tok${newId()}`;
    k.tokens.set(id, { bytes: null });
    return kalturaXml(`<objectType>KalturaUploadToken</objectType><id>${id}</id><status>0</status>`);
  }
  if (query.service === 'uploadtoken' && query.action === 'upload') {
    const token = k.tokens.get(String(query.uploadTokenId));
    if (!token) return kalturaError('Upload token not found');
    const raw = Buffer.isBuffer(body) ? body : Buffer.alloc(0);
    const boundary = /boundary=(?:"([^"]+)"|([^;]+))/.exec(req.headers['content-type'] ?? '');
    const marker = boundary?.[1] ?? boundary?.[2];
    let bytes = raw;
    let type = 'application/octet-stream';
    if (marker) {
      const part = raw.toString('latin1').split(`--${marker}`).find((p) => /name="fileData"/.test(p));
      if (part) {
        const start = part.indexOf('\r\n\r\n') + 4;
        bytes = Buffer.from(part.slice(start, part.lastIndexOf('\r\n')), 'latin1');
        type = /Content-Type:\s*([^\r\n]+)/i.exec(part)?.[1]?.trim() ?? type;
      }
    }
    token.bytes = bytes;
    token.type = type;
    return kalturaXml(`<objectType>KalturaUploadToken</objectType><id>${query.uploadTokenId}</id><status>2</status><fileSize>${bytes.length}</fileSize>`);
  }
  if (query.service === 'media' && query.action === 'addFromUploadedFile') {
    const token = k.tokens.get(String(query.uploadTokenId));
    if (!token?.bytes) return kalturaError('Upload token has no file');
    const id = `0_fake${String(k.nextEntry++).padStart(4, '0')}`;
    const mediaType = String(form['mediaEntry:mediaType'] ?? '1') === '5' ? 'audio' : 'video';
    const fallbackType = mediaType === 'audio' ? 'audio/mp4' : 'video/mp4';
    k.entries.set(id, {
      id,
      name: String(form['mediaEntry:name'] ?? 'Media'),
      mediaType,
      type: token.type && token.type !== 'application/octet-stream' ? token.type : fallbackType,
      bytes: token.bytes,
    });
    k.tokens.delete(String(query.uploadTokenId));
    return kalturaXml(`<objectType>KalturaMediaEntry</objectType><id>${id}</id><mediaType>${mediaType === 'audio' ? 5 : 1}</mediaType>`);
  }
  return kalturaError('Unknown service');
}

/** `POST /api/v1/media_objects` (create_media_object): Canvas records the Kaltura entry. */
function createMediaObject({ body }) {
  const input = nested(body);
  const entry = kaltura().entries.get(String(input.id ?? ''));
  if (!entry || !input.context_code) return badRequest({ errors: [{ message: 'id and context_code are required' }] });
  entry.context = String(input.context_code);
  entry.title = input.user_entered_title ?? input.title ?? entry.name;
  return {
    media_object: {
      id: `mo${entry.id}`,
      media_id: entry.id,
      media_type: entry.mediaType,
      title: entry.title,
      user_entered_title: entry.title,
      context_type: entry.context.startsWith('course_') ? 'Course' : 'User',
      attachment_id: null,
      uuid: `fakeuuid${entry.id}`,
    },
    embedded_iframe_url: `${BASE}/media_objects_iframe/${entry.id}`,
  };
}

function kalturaMedia({ params, req }) {
  const entry = kaltura().entries.get(params.entryId);
  if (!entry) return notFound();
  return serveBytes(entry.bytes, entry.type, `${entry.name}`, req);
}

// --- DocViewer for student annotation (ASSIGN-7) ------------------------------------------
//
// canvadoc_sessions_controller.rb#create: a session for the student's draft annotations or a
// submitted attempt's. The page stands in for DocViewer: tap the document to drop a label.

function canvadocSession({ body }) {
  const input = nested(body);
  const attempt = String(input.submission_attempt ?? '');
  const submissionId = String(input.submission_id ?? '');
  const assignmentId = submissionId.replace(/^s/, '');
  const c = course();
  const a = c && [...['201', '241', '110', '150', '225', '101']].map((id) => c.assignmentById(id, assignmentId)).find(Boolean);
  if (!a || !submissionId.startsWith('s')) return unauthorized();
  if (!a.annotatable) return unauthorized();
  if (!attempt) return badRequest({ errors: [{ message: 'submission_attempt is required' }] });
  if (attempt === 'draft') {
    const allowed = a.attempts ?? -1;
    if (allowed > 0 && c.attemptsOf(a).length >= allowed)
      return badRequest({ error: 'There are no more attempts available for this submission' });
    return {
      annotation_context_launch_id: `draft-${a.id}`,
      canvadocs_session_url: `${BASE}/fake/docviewer/draft-${a.id}`,
    };
  }
  const n = Number(attempt);
  if (!c.attemptsOf(a).some((att) => att.attempt === n && att.type === 'student_annotation'))
    return badRequest({ error: 'No annotations associated with that submission_attempt' });
  return {
    annotation_context_launch_id: `attempt-${a.id}-${n}`,
    canvadocs_session_url: `${BASE}/fake/docviewer/attempt-${a.id}-${n}`,
  };
}

function docviewerPage({ params }) {
  const launch = params.launchId;
  const m = /^(draft|attempt)-(\d+)(?:-(\d+))?$/.exec(launch);
  if (!m) return notFound();
  const readOnly = m[1] === 'attempt';
  const notes = docviewer().annotations.get(launch) ?? [];
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cell diagram.png - DocViewer</title>
<style>
body{margin:0;background:#525659;font:15px -apple-system,system-ui,sans-serif;color:#222}
.bar{position:sticky;top:0;z-index:2;background:#323639;color:#eee;padding:10px 14px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.bar input{flex:1;min-width:120px;font:16px -apple-system,system-ui;padding:8px;border-radius:6px;border:0}
.bar button{font:15px -apple-system,system-ui;padding:8px 12px;border-radius:6px;border:0;background:#4a90e2;color:#fff}
.page{position:relative;background:#fff;margin:16px auto;width:calc(100% - 32px);max-width:612px;padding:16px;box-sizing:border-box;box-shadow:0 1px 4px rgba(0,0,0,.4)}
.doc{position:relative}
.doc img{width:100%;display:block}
.pin{position:absolute;transform:translate(-50%,-100%);background:#d9480f;color:#fff;font:600 13px -apple-system,system-ui;padding:4px 8px;border-radius:12px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.hint{color:#555;margin:12px 0 0}
</style></head><body>
<div class="bar">${readOnly
    ? `<span>DocViewer (fake) · Attempt ${m[3]} · read only · <span id="count">${notes.length}</span> annotations</span>`
    : `<input id="label" placeholder="Label, then tap the diagram" aria-label="Annotation text" value="Nucleus"><button id="undo">Undo</button><span><span id="count">${notes.length}</span> saved</span>`}</div>
<div class="page"><div class="doc" id="doc"><img src="${BASE}/files/6003/download?verifier=fakeuuid6003" alt="Cell diagram"></div>
<p class="hint">${readOnly ? 'These are the labels you submitted.' : 'Type a label, then tap where it belongs. Labels save as you add them.'}</p></div>
<script>
var notes = ${JSON.stringify(notes)};
var readOnly = ${readOnly};
var doc = document.getElementById('doc');
function draw(){
  doc.querySelectorAll('.pin').forEach(function(p){p.remove();});
  notes.forEach(function(n){var el=document.createElement('div');el.className='pin';el.textContent=n.text;el.style.left=(n.x*100)+'%';el.style.top=(n.y*100)+'%';doc.appendChild(el);});
  document.getElementById('count').textContent = notes.length;
}
function save(){fetch(location.pathname + '/annotations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({notes:notes})});}
draw();
if(!readOnly){
  doc.addEventListener('click',function(e){
    var label=document.getElementById('label').value.trim(); if(!label) return;
    var r=doc.getBoundingClientRect();
    notes.push({text:label,x:(e.clientX-r.left)/r.width,y:(e.clientY-r.top)/r.height});
    draw(); save();
  });
  document.getElementById('undo').addEventListener('click',function(){notes.pop();draw();save();});
}
</script></body></html>`;
  return { status: 200, body: html, headers: { 'Content-Type': 'text/html; charset=utf-8' } };
}

function saveAnnotations({ params, body }) {
  if (!params.launchId.startsWith('draft-')) return unauthorized();
  const notes = Array.isArray(body?.notes) ? body.notes.slice(0, 50) : [];
  docviewer().annotations.set(params.launchId, notes);
  return { ok: true, count: notes.length };
}

// --- Tool pickers: the homework_submission placement (ASSIGN-9) ----------------------------
//
// lti_apps_controller.rb#launch_definitions, external_tools_controller.rb#resource_selection
// (the "borderless" page that launches the tool into iframe#tool_content), and the pages
// Canvas renders when a tool answers: LTI 1.3 deep_linking_response (posts
// LtiDeepLinkingResponse to the parent window) and LTI 1.1 external_content/success
// (posts externalContentReady and A2ExternalContentReady). Tools load from 127.0.0.1 so they
// sit on a different origin from Canvas, as real tools do.
//   811 Drive Picker (LTI 1.1): a file (FileItem) or a share link (ContentItem)
//   812 Studio (LTI 1.3): a recording (ltiResourceLink with lookup_uuid) or a public link

const TOOL_HOST = BASE.replace('localhost', '127.0.0.1');
const homeworkTools = {
  201: [
    { id: '811', name: 'Drive Picker', description: 'Pick a file or a share link from Google Drive.', domain: 'drive.example.com', lti: '1.1' },
    { id: '812', name: 'Studio', description: 'Submit one of your Studio recordings.', domain: 'studio.example.com', lti: '1.3' },
  ],
  225: [{ id: '812', name: 'Studio', description: 'Submit one of your Studio recordings.', domain: 'studio.example.com', lti: '1.3' }],
};
const toolById = (courseId, id) => (homeworkTools[courseId] ?? []).find((t) => t.id === id);

const driveFiles = {
  'lab-notes.txt': { fixture: 'lab-notes.txt', type: 'text/plain', title: 'Lab notebook, week 9.txt' },
  'syllabus.pdf': { fixture: 'syllabus.pdf', type: 'application/pdf', title: 'Lab notebook export.pdf' },
};

function launchDefinitions({ params, query }) {
  const placements = query.placements ?? [];
  if (!placements.includes('homework_submission')) return [];
  return (homeworkTools[params.courseId] ?? []).map((t) => ({
    definition_type: 'ContextExternalTool',
    definition_id: t.id,
    url: `https://${t.domain}/lti/launch`,
    name: t.name,
    description: t.description,
    domain: t.domain,
    placements: {
      homework_submission: {
        message_type: t.lti === '1.3' ? 'LtiDeepLinkingRequest' : 'ContentItemSelectionRequest',
        url: `https://${t.domain}/lti/launch`,
        title: t.name,
      },
    },
  }));
}

const page = (title, body) => ({
  status: 200,
  body: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>body{margin:0;font:16px -apple-system,system-ui,sans-serif;color:#2d3b45;background:#fff}iframe{border:0;width:100%;height:100vh;display:block}
main{padding:16px}h1{font-size:20px;margin:0 0 4px}p{color:#6b7780;margin:0 0 16px}.row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 0;border-bottom:1px solid #e5e8ea}
.row b{display:block}.row small{color:#6b7780}button{font:15px -apple-system,system-ui;padding:10px 14px;border-radius:8px;border:0;background:#0b874b;color:#fff}button.secondary{background:#e5e8ea;color:#2d3b45}</style></head><body>${body}</body></html>`,
  headers: { 'Content-Type': 'text/html; charset=utf-8' },
});

/** Canvas's resource selection page: launches the tool into an iframe, as the web's submission page does. */
function resourceSelection({ params, query }) {
  const tool = toolById(params.courseId, params.toolId);
  if (!tool || query.launch_type !== 'homework_submission')
    return page('Not found', '<main><h1>That tool isn’t available here.</h1></main>');
  const src = `${TOOL_HOST}/fake/hw-tool/${tool.id}?course=${params.courseId}&assignment=${encodeURIComponent(query.assignment_id ?? '')}`;
  return page(tool.name, `<iframe id="tool_content" name="tool_content" title="${tool.name}" src="${src}" allow="camera; microphone"></iframe>`);
}

/** The tool itself. Picking sends the answer back to Canvas, which forwards it to the top window. */
function toolPicker({ params, query }) {
  const tool = ['811', '812'].includes(params.toolId) ? params.toolId : null;
  if (!tool) return page('Not found', '<main><h1>Unknown tool</h1></main>');
  const back = (items) =>
    `${BASE}/courses/${query.course}/${tool === '812' ? 'deep_linking_response' : 'external_content/success/external_tool_dialog'}?items=${encodeURIComponent(JSON.stringify(items))}`;
  const rows =
    tool === '811'
      ? Object.entries(driveFiles)
          .map(
            ([key, f]) => `<div class="row"><span><b>${f.title}</b><small>${f.type === 'application/pdf' ? 'PDF' : 'Text'} · My Drive</small></span>
<button onclick="location.href='${back([{ '@type': 'FileItem', url: `${TOOL_HOST}/fake/hw-tool/811/files/${key}`, title: f.title, mediaType: f.type }])}'">Select</button></div>`,
          )
          .join('') +
        `<div class="row"><span><b>Shared notebook</b><small>Anyone with the link can view</small></span>
<button class="secondary" onclick="location.href='${back([{ '@type': 'ContentItem', url: 'https://docs.example.com/d/lab-notebook-week-9', title: 'Lab notebook (shared)' }])}'">Share link</button></div>`
      : [
          ['Pipetting walkthrough', '3:12', 'r1'],
          ['Lab safety check', '1:05', 'r2'],
        ]
          .map(
            ([title, length, id]) => `<div class="row"><span><b>${title}</b><small>Recording · ${length}</small></span>
<button onclick="location.href='${back([{ type: 'ltiResourceLink', url: `https://studio.example.com/lti/media/${id}`, title, lookup_uuid: `lookup-${id}` }])}'">Submit this</button></div>`,
          )
          .join('') +
        `<div class="row"><span><b>Public link to my channel</b><small>Web page</small></span>
<button class="secondary" onclick="location.href='${back([{ type: 'link', url: 'https://studio.example.com/channel/evan', title: 'My Studio channel' }])}'">Pick link</button></div>`;
  const name = tool === '811' ? 'Drive Picker' : 'Studio';
  return page(name, `<main><h1>${name} (fake)</h1><p>Pick something to turn in.</p>${rows}
<p style="margin-top:16px"><button class="secondary" onclick="location.href='${BASE}/courses/${query.course}/${tool === '812' ? 'deep_linking_response' : 'external_content/success/external_tool_dialog'}?items=%5B%5D&errormsg=${encodeURIComponent('You closed the picker without choosing anything.')}'">Cancel</button></p></main>`);
}

/** lti/ims/deep_linking_controller.rb#deep_linking_response, as DeepLinkingResponse.tsx posts it. */
function deepLinkingResponse({ params, query }) {
  let items = [];
  try {
    items = JSON.parse(query.items ?? '[]');
  } catch {
    items = [];
  }
  const message = {
    subject: 'LtiDeepLinkingResponse',
    placement: 'homework_submission',
    content_items: items,
    ...(query.errormsg && { errormsg: query.errormsg }),
    ltiEndpoint: `${BASE}/courses/${params.courseId}/external_tools/retrieve`,
    reloadpage: false,
  };
  return page('Retrieving content', `<main><p>Retrieving content…</p></main>
<script>(window.parent || window.opener).postMessage(${JSON.stringify(message)}, '*');</script>`);
}

/** external_content_controller.rb#success for LTI 1.1, as external_content_success/index.tsx posts it. */
function externalContentSuccess({ query }) {
  let items = [];
  try {
    items = JSON.parse(query.items ?? '[]');
  } catch {
    items = [];
  }
  const parent = '(window.parent || window.opener)';
  const ready = { subject: 'externalContentReady', contentItems: items, service_id: '', service: 'external_tool_dialog' };
  const a2 = { subject: 'A2ExternalContentReady', content_items: items, ...(query.errormsg && { errormsg: query.errormsg }) };
  return page('Success', `<main><p>Success. This should close on its own.</p></main>
<script>${parent}.postMessage(${JSON.stringify(ready)}, '*'); ${parent}.postMessage(${JSON.stringify(a2)}, '*');</script>`);
}

function driveFile({ params, req }) {
  const f = driveFiles[params.name];
  if (!f) return notFound();
  return serveBytes(readFileSync(join(fixtures, f.fixture)), f.type, f.title, req, { inline: false });
}

// --- Routes -------------------------------------------------------------------------

const prefix = '/api/v1/courses/:courseId/assignments/:assignmentId/submissions';

export const routes = [
  { path: `${prefix}/:userId/files`, method: 'POST', handler: preflight('submission') },
  { path: `${prefix}/:userId/comments/files`, method: 'POST', handler: preflight('comment') },
  { path: prefix, method: 'POST', handler: submit },
  { path: `${prefix}/:userId`, method: 'PUT', handler: update },
  // ServicesApiController: Kaltura is on unless /fake/kaltura/off turned it off.
  {
    path: '/api/v1/services/kaltura',
    handler: () =>
      kaltura().enabled
        ? { enabled: true, domain: 'localhost:3030', resource_domain: 'localhost:3030', rtmp_domain: 'localhost:3030', partner_id: '100' }
        : { enabled: false },
  },
  {
    path: '/api/v1/services/kaltura_session',
    method: 'POST',
    handler: ({ query }) => {
      if (!kaltura().enabled) return { status: 500, body: { errors: [{ message: 'Kaltura is not configured' }] } };
      return {
        ks: `fakeks${newId()}`,
        subp_id: '10000',
        partner_id: '100',
        uid: `${user.id}_1`,
        serverTime: Math.floor(Date.now() / 1000),
        ...(query.include_upload_config && {
          kaltura_setting: { domain: 'localhost:3030', protocol: 'http', partner_id: '100', subpartner_id: '10000' },
        }),
      };
    },
  },
  { path: '/api/v1/media_objects', method: 'POST', handler: createMediaObject },
  { path: '/api/v1/canvadoc_session', method: 'POST', handler: canvadocSession },
  { path: '/api/v1/courses/:courseId/lti_apps/launch_definitions', handler: launchDefinitions },

  // Public: the token, a storage signature, or a session authorizes these on real Canvas.
  { path: '/fake/submission-upload/:token', method: 'POST', public: true, handler: uploadBytes },
  { path: '/fake/submission-files/:fileId/:name', public: true, handler: storage },
  { path: '/fake/submission-files/:fileId/:name', method: 'HEAD', public: true, handler: storage },
  { path: '/fake/annotated/:fileId', public: true, handler: annotated },
  { path: '/fake/submissions/reset', method: 'POST', public: true, handler: reset },
  { path: '/api_v3/index.php', method: 'POST', public: true, handler: kalturaApi },
  { path: '/fake/kaltura-media/:entryId', public: true, handler: kalturaMedia },
  ...['on', 'off'].map((mode) => ({
    path: `/fake/kaltura/${mode}`,
    method: 'POST',
    public: true,
    handler: () => {
      kaltura().enabled = mode === 'on';
      return { enabled: kaltura().enabled };
    },
  })),
  { path: '/fake/docviewer/:launchId', public: true, handler: docviewerPage },
  { path: '/fake/docviewer/:launchId/annotations', method: 'POST', public: true, handler: saveAnnotations },
  { path: '/courses/:courseId/external_tools/:toolId/resource_selection', public: true, handler: resourceSelection },
  { path: '/fake/hw-tool/:toolId', public: true, handler: toolPicker },
  { path: '/fake/hw-tool/811/files/:name', public: true, handler: driveFile },
  { path: '/courses/:courseId/deep_linking_response', public: true, handler: deepLinkingResponse },
  {
    path: '/courses/:courseId/external_content/success/external_tool_dialog',
    public: true,
    handler: externalContentSuccess,
  },
];
