import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = await realpath(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.PORT || 8787);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT must be an integer between 1 and 65535.');
  process.exit(1);
}

function sendError(response, status, message) {
  response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  response.end(message);
}

function isInsideRoot(path) {
  const relativePath = relative(root, path);
  return relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
}

const server = createServer(async (request, response) => {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    sendError(response, 405, 'Method not allowed.');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent((request.url || '/').split('?')[0]);
  } catch {
    sendError(response, 400, 'Invalid URL encoding.');
    return;
  }

  if (!pathname.startsWith('/') || /[\\\0:]/u.test(pathname) ||
      pathname.split('/').some(part => part.startsWith('.'))) {
    sendError(response, 403, 'This path is not available.');
    return;
  }

  const requestedPath = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!isInsideRoot(requestedPath)) {
    sendError(response, 403, 'This path is not available.');
    return;
  }

  try {
    const filePath = await realpath(requestedPath);
    if (!isInsideRoot(filePath)) {
      sendError(response, 403, 'This path is not available.');
      return;
    }
    const info = await stat(filePath);
    if (!info.isFile()) {
      sendError(response, 404, 'File not found.');
      return;
    }
    const data = request.method === 'HEAD' ? null : await readFile(filePath);
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Content-Length': info.size,
    });
    response.end(data);
  } catch (error) {
    const missing = error.code === 'ENOENT' || error.code === 'ENOTDIR';
    sendError(response, missing ? 404 : 500, missing ? 'File not found.' : 'Unable to read file.');
  }
});

server.on('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${port} is already in use. Open http://127.0.0.1:${port} if Shelf is running, or set PORT to another port.`);
  } else {
    console.error(`Could not start Shelf: ${error.message}`);
  }
  process.exitCode = 1;
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Shelf is ready at http://127.0.0.1:${port}`);
  console.log('Press Ctrl+C to stop the local server.');
});
