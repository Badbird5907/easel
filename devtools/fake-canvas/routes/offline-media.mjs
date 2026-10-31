/** OFF-3 direct assets: real fixture bytes, authenticated same-origin redirects and captions. */
import { readFileSync } from 'node:fs';
const fixture = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url));
export const routes = [
  {
    path: '/fake/offline-media/image.png',
    handler: () => ({ body: fixture('cell-diagram.png'), headers: { 'Content-Type': 'image/png' } }),
  },
  {
    path: '/fake/offline-media/audio.m4a',
    handler: () => ({ body: fixture('office-hours.m4a'), headers: { 'Content-Type': 'audio/mp4' } }),
  },
  {
    path: '/fake/offline-media/video.mp4',
    handler: () => ({ body: fixture('lecture-clip.mp4'), headers: { 'Content-Type': 'video/mp4' } }),
  },
  {
    path: '/fake/offline-media/captions.vtt',
    handler: () => ({
      body: 'WEBVTT\n\n00:00.000 --> 00:01.000\nA cell divides.\n',
      headers: { 'Content-Type': 'text/vtt' },
    }),
  },
  {
    path: '/fake/offline-media/redirect',
    handler: () => ({ status: 302, body: '', headers: { Location: '/fake/offline-media/image.png' } }),
  },
];
