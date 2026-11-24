const styles = {
  error: '\u001B[1;31m',
  progress: '\u001B[1;34m',
  result: '\u001B[1;92m',
  warning: '\u001B[1;33m',
};

const reset = '\u001B[0m';
const events = [
  ['error', /\b(?:ERROR|FAILED|FAIL)\b/gi],
  ['progress', /\b(?:START|Starting|Running|PROGRESS)\b/gi],
  ['result', /\b(?:COMPLETED|Comparison|Quality evaluation)\b/gi],
  ['warning', /\b(?:WARN|WARNING)\b/gi],
];

export function supportsColor(stream = process.stdout, environment = process.env) {
  return Boolean(stream?.isTTY) && environment.TERM !== 'dumb' && !Object.hasOwn(environment, 'NO_COLOR');
}

export function formatEvents(message, options = {}) {
  const text = String(message);
  if (!supportsColor(options.stream, options.environment)) return text;
  const formatted = events.reduce((current, [style, expression]) =>
    current.replace(expression, (keyword) => `${styles[style]}${keyword}${reset}`), text);
  return formatted.replace(/(^|\n)(Result)\b/gi, (_match, lineStart, keyword) =>
    `${lineStart}${styles.result}${keyword}${reset}`);
}

export function log(message) {
  console.log(formatEvents(message));
}

export function error(message) {
  console.error(formatEvents(message, { stream: process.stderr }));
}

export async function withColorizedOutput(operation, stream = process.stdout, environment = process.env) {
  if (!supportsColor(stream, environment)) return operation();
  const write = stream.write;
  stream.write = function colorizedWrite(chunk, encoding, callback) {
    return write.call(this, formatEvents(chunk, { stream, environment }), encoding, callback);
  };
  try {
    return await operation();
  } finally {
    stream.write = write;
  }
}
