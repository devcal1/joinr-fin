// Test values that the guard must flag. They are assembled at runtime so that no test source
// contains a real-looking address, email, phone number or id (the guard scans its own tests).
// Everything here is fictional.

const dot = (...parts: string[]) => parts.join('.');

export const PRIVATE_IP = dot('10', '1', '2', '3');
export const CGNAT_IP = dot('100', '64', '1', '9');
export const LAN_IP = dot('192', '168', '1', '20');

export const EMAIL = ['someone', dot('mailbox', 'com', 'au')].join('@');
export const EMAIL_UPPER = ['Some.One', dot('Company', 'COM')].join('@');

export const DRIVE_ID = 'Zx9'.repeat(8) + '_-q';
export const DRIVE_DOC_URL = [
  'https:',
  '',
  dot('docs', 'google', 'com'),
  'spreadsheets',
  'd',
  DRIVE_ID,
  'edit',
].join('/');
export const DRIVE_FOLDER_URL = [
  'https:',
  '',
  dot('drive', 'google', 'com'),
  'drive',
  'folders',
  DRIVE_ID,
].join('/');
export const DRIVE_OPEN_URL = `${['https:', '', dot('drive', 'google', 'com'), 'open'].join('/')}?id=${DRIVE_ID}`;
export const USERCONTENT_URL = ['https:', '', dot('lh3', 'googleusercontent', 'com'), 'pic'].join(
  '/',
);
export const SCRIPT_URL = [
  'https:',
  '',
  dot('script', 'google', 'com'),
  'macros',
  's',
  'x',
  'exec',
].join('/');

export const MOBILE_SPACED = ['04', '12 ', '345 ', '678'].join('');
export const MOBILE_PLAIN = ['04', '12', '345', '678'].join('');
export const MOBILE_INTL = ['+61 ', '412 ', '345 ', '678'].join('');
export const MOBILE_INTL_PLAIN = ['+61', '412', '345', '678'].join('');
export const LANDLINE_PAREN = ['(03) ', '9123 ', '4567'].join('');
export const LANDLINE_SPACED = ['02 ', '9123 ', '4567'].join('');
export const LANDLINE_PLAIN = ['08', '9123', '4567'].join('');
export const LANDLINE_INTL = ['+61 ', '3 ', '9123 ', '4567'].join('');

export const ABN = ['51', '824', '753', '556'].join(' ');

/** File heads for content sniffing: format signatures only, no data. */
export const SAMPLE_HEADS = {
  sqlite: Buffer.concat([Buffer.from('SQLite format 3\0', 'latin1'), Buffer.alloc(84, 1)]),
  xlsx: Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26, 1),
    Buffer.from('[Content_Types].xml ... _rels/.rels ... xl/workbook.xml', 'latin1'),
  ]),
  ods: Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.alloc(26, 1),
    Buffer.from('mimetypeapplication/vnd.oasis.opendocument.spreadsheet', 'latin1'),
  ]),
  xls: Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]),
  zip: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('word/document.xml')]),
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x41]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x41]),
  gif: Buffer.from('GIF89a text-looking bytes', 'latin1'),
  webp: Buffer.from('RIFF1234WEBPVP8 ', 'latin1'),
  woff2: Buffer.from('wOF2 text-looking bytes', 'latin1'),
};
