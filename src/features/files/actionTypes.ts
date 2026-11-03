/** Origins identify authored presentation, never native/server text or operation inputs. */
export type SaveDestination = {
  label: string;
  origin?: 'folder' | 'that-folder' | 'downloads' | 'iphone' | 'ipad' | 'photos' | 'gallery';
};

export type FileActionOrigin =
  | {
      reason:
        | 'sharing-unavailable'
        | 'folder-picker'
        | 'downloads-copy'
        | 'photos-permission'
        | 'gallery-permission'
        | 'print-open'
        | 'print-rendition'
        | 'print-unsupported';
    }
  | { reason: 'folder-copy'; destination: SaveDestination }
  | { reason: 'no-app'; file: { name: string; filename?: string; contentType?: string } };
