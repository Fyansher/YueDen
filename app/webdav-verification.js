'use strict';

async function retryRead(read, { attempts = 3, delayMs = 250, accept = Boolean } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch (error) { lastError = error; }
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, delayMs * (2 ** attempt)));
  }
  if (lastError) throw lastError;
  return null;
}

module.exports = { retryRead };
