const fs = require('fs');
const path = require('path');

let memoizedRules = null;

function getRules () {
  if (memoizedRules) {
    return memoizedRules;
  }

  const root = process.cwd();
  const ignorePath = path.join(root, '.artignore');
  const rules = [];

  if (fs.existsSync(ignorePath)) {
    const lines = fs.readFileSync(ignorePath, 'utf8').split(/\r?\n/);

    for (let line of lines) {
      line = line.trim();

      if (!line || line.startsWith('#')) {
        continue;
      }

      let regexStr = line
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\/\*\*\//g, '(/.+/|/)')
        .replace(/\*/g, '[^/]+')
        .replace(/\/$/, '(/.+)?');

      if (line.startsWith('/')) {
        regexStr = '^' + regexStr.slice(1);
      } else {
        regexStr = '(^|/)' + regexStr;
      }

      rules.push(new RegExp(regexStr));
    }
  }

  memoizedRules = rules;

  return rules;
}

function shouldIgnore (relPath) {
  const normalizedPath = relPath.split(path.sep).join('/');

  if (normalizedPath === '.art' || normalizedPath.startsWith('.art/')) {
    return true;
  }

  const rules = getRules();

  return rules.some(rule => rule.test(normalizedPath));
}

module.exports = shouldIgnore;
