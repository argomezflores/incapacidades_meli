'use strict';

function requiredFields(obj, fields) {
  for (const field of fields) {
    const val = obj[field];
    if (!val || String(val).trim() === '') {
      return `Campo requerido: ${field}`;
    }
  }
  return null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidDate(str) {
  const d = new Date(str);
  return !isNaN(d.getTime());
}

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB decodificados

const MAGIC_BYTE_CHECKS = {
  'image/jpeg':       (b) => b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF,
  'image/png':        (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47 &&
                             b[4] === 0x0D && b[5] === 0x0A && b[6] === 0x1A && b[7] === 0x0A,
  'application/pdf':  (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46,
  'image/webp':       (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
                             b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50,
  'image/heic':       isHeifFamily,
  'image/heif':       isHeifFamily
};

function isHeifFamily(b) {
  if (b[4] !== 0x66 || b[5] !== 0x74 || b[6] !== 0x79 || b[7] !== 0x70) return false;
  const brand = String.fromCharCode(b[8], b[9], b[10], b[11]);
  return ['heic','heix','heim','heis','hevc','hevx','mif1','msf1'].includes(brand);
}

/**
 * Valida un dataURL/base64 de archivo adjunto.
 * Devuelve { ok: true, mime, sizeBytes } o { ok: false, error }.
 */
function validateAttachment(base64String, fileName) {
  if (!base64String) return { ok: true, mime: null, sizeBytes: 0 };

  let declaredMime = null;
  let pureBase64 = base64String;
  const dataUriMatch = /^data:([\w/+.-]+);base64,(.+)$/i.exec(base64String);
  if (dataUriMatch) {
    declaredMime = dataUriMatch[1].toLowerCase();
    pureBase64 = dataUriMatch[2];
  }

  if (!declaredMime && fileName) {
    const ext = String(fileName).toLowerCase().split('.').pop();
    declaredMime = {
      jpg: 'image/jpeg', jpeg: 'image/jpeg',
      png: 'image/png',
      pdf: 'application/pdf',
      webp: 'image/webp',
      heic: 'image/heic', heif: 'image/heif'
    }[ext] || null;
  }

  if (!declaredMime || !MAGIC_BYTE_CHECKS[declaredMime]) {
    return { ok: false, error: 'Tipo de archivo no permitido. Sube foto (JPG/PNG/WEBP/HEIC) o PDF.' };
  }

  let buf;
  try {
    buf = Buffer.from(pureBase64, 'base64');
  } catch {
    return { ok: false, error: 'Archivo corrupto o mal codificado.' };
  }

  if (buf.length === 0) return { ok: false, error: 'Archivo vacío.' };
  if (buf.length > MAX_FILE_BYTES) {
    return { ok: false, error: 'El archivo excede el tamaño máximo de 8MB.' };
  }
  if (buf.length < 12) return { ok: false, error: 'Archivo demasiado pequeño o corrupto.' };

  const check = MAGIC_BYTE_CHECKS[declaredMime];
  if (!check(buf)) {
    return { ok: false, error: 'El contenido del archivo no coincide con su tipo declarado.' };
  }

  return { ok: true, mime: declaredMime, sizeBytes: buf.length };
}

module.exports = {
  requiredFields,
  isValidEmail,
  isValidDate,
  validateAttachment,
  MAX_FILE_BYTES
};
